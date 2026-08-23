import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import type { QbtFile, QbtMainData, QbtPeersSync, QbtProperties, QbtTracker } from "./types";

export class QbittorrentError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "QbittorrentError";
	}
}

/**
 * qBittorrent WebAPI v2 client.
 *
 * Two version-drift hazards this handles, both real:
 *  - v5.0 renamed the pause/resume endpoints to stop/start.
 *  - Auth may be bypassed entirely by WebUI\AuthSubnetWhitelist (our default —
 *    the WebUI port is never published), so credentials are optional.
 */
export class QbittorrentClient {
	/**
	 * Whatever session cookie qBittorrent hands us, verbatim. The name is NOT
	 * stable: v4 used `SID`, v5 uses `QBT_SID_<port>`. Hard-coding it means the
	 * cookie is never echoed, every request starts a fresh session, and
	 * /sync/maindata returns `full_update: true` forever — deltas silently
	 * degrade into full snapshots. qBittorrent issues this cookie even on the
	 * AuthSubnetWhitelist bypass path, where no login happens at all.
	 */
	private cookie: string | null = null;
	private loggingIn: Promise<void> | null = null;

	constructor(
		private readonly baseUrl = env.QBT_URL.replace(/\/$/, ""),
		private readonly username = env.QBT_USERNAME,
		private readonly password = env.QBT_PASSWORD,
	) {}

	// ── transport ──────────────────────────────────────────────────────────

	private captureCookie(res: Response) {
		const setCookie = res.headers.get("set-cookie");
		if (!setCookie) return;
		const pair = setCookie.split(";")[0]?.trim();
		if (pair?.includes("=")) this.cookie = pair;
	}

	private async raw(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		if (this.cookie) headers.set("cookie", this.cookie);
		// qBittorrent validates Referer when host-header validation is on.
		headers.set("Referer", this.baseUrl);
		const res = await fetch(`${this.baseUrl}/api/v2${path}`, { ...init, headers });
		this.captureCookie(res);
		return res;
	}

	private async login(): Promise<void> {
		if (!this.username || !this.password) return; // subnet whitelist path
		if (this.loggingIn) return this.loggingIn;

		this.loggingIn = (async () => {
			const body = new URLSearchParams({ username: this.username!, password: this.password! });
			const res = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
				method: "POST",
				body,
				headers: { Referer: this.baseUrl },
			});
			const text = await res.text();
			if (!res.ok || text.trim() !== "Ok.") {
				throw new QbittorrentError(`qBittorrent login failed: ${text.trim() || res.status}`, res.status);
			}
			this.captureCookie(res);
			logger.info("qBittorrent session established via login");
		})().finally(() => {
			this.loggingIn = null;
		});

		return this.loggingIn;
	}

	/** One transparent re-login on 403 — sessions expire on qBittorrent restart. */
	private async request(path: string, init: RequestInit = {}): Promise<Response> {
		let res: Response;
		try {
			res = await this.raw(path, init);
		} catch (err) {
			throw new QbittorrentError(`qBittorrent unreachable: ${(err as Error).message}`);
		}

		if (res.status === 403) {
			this.cookie = null;
			await this.login();
			res = await this.raw(path, init);
		}
		if (!res.ok) {
			throw new QbittorrentError(`qBittorrent ${path} → ${res.status}`, res.status);
		}
		return res;
	}

	private async getJson<T>(path: string): Promise<T> {
		return (await this.request(path)).json() as Promise<T>;
	}

	private post(path: string, form: Record<string, string>) {
		return this.request(path, {
			method: "POST",
			body: new URLSearchParams(form),
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});
	}

	/** v5 renamed pause→stop and resume→start. Try the new name, fall back. */
	private async postWithFallback(modern: string, legacy: string, form: Record<string, string>) {
		try {
			return await this.post(modern, form);
		} catch (err) {
			if (err instanceof QbittorrentError && (err.status === 404 || err.status === 405)) {
				return this.post(legacy, form);
			}
			throw err;
		}
	}

	// ── app ────────────────────────────────────────────────────────────────

	async version(): Promise<string> {
		return (await this.request("/app/version")).text();
	}

	async webapiVersion(): Promise<string> {
		return (await this.request("/app/webapiVersion")).text();
	}

	// ── sync ───────────────────────────────────────────────────────────────

	/** Delta endpoint. Pass the previous rid; 0 asks for a full snapshot. */
	syncMainData(rid = 0): Promise<QbtMainData> {
		return this.getJson<QbtMainData>(`/sync/maindata?rid=${rid}`);
	}

	syncTorrentPeers(hash: string, rid = 0): Promise<QbtPeersSync> {
		return this.getJson<QbtPeersSync>(`/sync/torrentPeers?hash=${hash}&rid=${rid}`);
	}

	// ── torrents ───────────────────────────────────────────────────────────

	/**
	 * sequentialDownload + firstLastPiecePrio are set at add time, always.
	 * They cost nothing and are what make partial playback possible later.
	 */
	async addMagnet(magnet: string, opts: { category?: string } = {}): Promise<void> {
		await this.post("/torrents/add", {
			urls: magnet,
			category: opts.category ?? env.QBT_CATEGORY,
			sequentialDownload: "true",
			firstLastPiecePrio: "true",
		});
	}

	/** Upload a .torrent file. Multipart — fetch sets the boundary itself, so
	 *  never set content-type by hand here. */
	async addTorrentFile(file: Buffer, filename: string, opts: { category?: string } = {}): Promise<void> {
		const form = new FormData();
		form.append("torrents", new Blob([new Uint8Array(file)], { type: "application/x-bittorrent" }), filename);
		form.append("category", opts.category ?? env.QBT_CATEGORY);
		form.append("sequentialDownload", "true");
		form.append("firstLastPiecePrio", "true");
		await this.request("/torrents/add", { method: "POST", body: form });
	}

	async pause(hash: string) {
		await this.postWithFallback("/torrents/stop", "/torrents/pause", { hashes: hash });
	}

	async resume(hash: string) {
		await this.postWithFallback("/torrents/start", "/torrents/resume", { hashes: hash });
	}

	async remove(hash: string, deleteFiles: boolean) {
		await this.post("/torrents/delete", { hashes: hash, deleteFiles: String(deleteFiles) });
	}

	async recheck(hash: string) {
		await this.post("/torrents/recheck", { hashes: hash });
	}

	async setFilePriority(hash: string, indexes: number[], priority: number) {
		await this.post("/torrents/filePrio", {
			hash,
			id: indexes.join("|"),
			priority: String(priority),
		});
	}

	files(hash: string): Promise<QbtFile[]> {
		return this.getJson<QbtFile[]>(`/torrents/files?hash=${hash}`);
	}

	properties(hash: string): Promise<QbtProperties> {
		return this.getJson<QbtProperties>(`/torrents/properties?hash=${hash}`);
	}

	trackers(hash: string): Promise<QbtTracker[]> {
		return this.getJson<QbtTracker[]>(`/torrents/trackers?hash=${hash}`);
	}

	pieceStates(hash: string): Promise<number[]> {
		return this.getJson<number[]>(`/torrents/pieceStates?hash=${hash}`);
	}

	/** Ensures our category exists so torrents land under a known save path. */
	// ── transfer limits ──────────────────────────────────────────────────────
	// These matter more than they look: Oracle's free tier caps egress at 10 TB
	// a month, and SEEDING counts. An unthrottled box will exhaust it.

	async getTransferLimits(): Promise<{ dlLimitBps: number; upLimitBps: number; altEnabled: boolean }> {
		const [dl, up, alt] = await Promise.all([
			this.request("/transfer/downloadLimit"),
			this.request("/transfer/uploadLimit"),
			this.request("/transfer/speedLimitsMode"),
		]);
		return {
			dlLimitBps: Number(await dl.text()) || 0,
			upLimitBps: Number(await up.text()) || 0,
			altEnabled: (await alt.text()).trim() === "1",
		};
	}

	async setTransferLimits(limits: { dlLimitBps?: number; upLimitBps?: number }) {
		if (limits.dlLimitBps !== undefined) {
			await this.post("/transfer/setDownloadLimit", { limit: String(limits.dlLimitBps) });
		}
		if (limits.upLimitBps !== undefined) {
			await this.post("/transfer/setUploadLimit", { limit: String(limits.upLimitBps) });
		}
	}

	/** Seeding ratio is the real long-run egress control — a rate cap only slows it. */
	async getPreferences(): Promise<Record<string, unknown>> {
		const res = await this.request("/app/preferences");
		return (await res.json()) as Record<string, unknown>;
	}

	async setPreferences(prefs: Record<string, unknown>) {
		await this.post("/app/setPreferences", { json: JSON.stringify(prefs) });
	}

	async ensureCategory(): Promise<void> {
		try {
			await this.post("/torrents/createCategory", {
				category: env.QBT_CATEGORY,
				savePath: env.DOWNLOADS_DIR,
			});
		} catch (err) {
			// Already exists → qBittorrent returns 409. Anything else is real.
			if (!(err instanceof QbittorrentError && err.status === 409)) throw err;
		}
	}
}

export const qbt = new QbittorrentClient();
