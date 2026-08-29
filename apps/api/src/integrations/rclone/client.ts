import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import type { RcAbout, RcJobStatus, RcListEntry, RcRemote, RcRemoteConfig, RcTransferStats } from "./types";

export class RcloneError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "RcloneError";
	}
}

/**
 * Client for rclone's remote-control daemon.
 *
 * WHY A DAEMON rather than shelling out to `rclone copy`: bytes must not flow
 * through Node — the same rule that puts Caddy in front of downloads. rcd moves
 * the data itself and this only sends jobs and reads progress, which is exactly
 * the shape the qBittorrent integration already has.
 *
 * WHY CREDENTIALS ARE NOT STORED BY US: `config/create` hands them to rclone,
 * which persists them in its own config file (0600, on the data volume).
 * Postgres never holds a secret key, so a database dump cannot leak one and the
 * nightly pg_dump carries nothing sensitive.
 *
 * They are NOT encrypted, and `obscure` does not help: rclone only obscures
 * options it declares as password-type, so an S3 `secret_access_key` is written
 * and returned verbatim. Verified against a live daemon rather than assumed.
 * `config/get` will therefore hand back a working secret to anything that can
 * call it — which is why redactConfig() exists below and why no route returns
 * raw remote config.
 *
 * The daemon runs unauthenticated on the compose network and is never published.
 * Anything reachable here can read and write every configured remote.
 */
export class RcloneClient {
	constructor(private readonly baseUrl = env.RCLONE_URL.replace(/\/$/, "")) {}

	/**
	 * Every rc endpoint is POST with a JSON body, even the read-only ones.
	 *
	 * Always with a deadline. A connection test against a provider that will
	 * never answer — a mistyped endpoint, a token issued to a different client —
	 * leaves rclone retrying on its own backoff, and this call runs inside the
	 * request that adds a remote. Without a deadline the browser waits for
	 * however long rclone decides to keep trying, which reads as a frozen app
	 * rather than a rejected credential.
	 */
	private async rc<T>(path: string, body: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
		let res: Response;
		try {
			res = await fetch(`${this.baseUrl}/${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (err) {
			if ((err as Error).name === "TimeoutError") {
				throw new RcloneError("The provider did not respond in time — check the endpoint, keys and bucket");
			}
			// The daemon being down is expected on a box that never configured a
			// remote, so this is not logged as an error by the caller.
			throw new RcloneError(`rclone unreachable: ${(err as Error).message}`);
		}

		const text = await res.text();
		if (!res.ok) {
			// rclone puts a human-readable reason in `error`. It can contain the
			// remote's own error text (a bucket name, a 403 from the provider),
			// which is what makes a failed connection test diagnosable.
			let reason = text.slice(0, 300);
			try {
				const parsed = JSON.parse(text) as { error?: string };
				if (parsed.error) reason = parsed.error;
			} catch {
				/* not JSON — keep the raw text */
			}
			throw new RcloneError(reason, res.status);
		}

		return (text ? JSON.parse(text) : {}) as T;
	}

	/** True when the daemon answers at all. Used to decide whether to offer the feature. */
	async reachable(): Promise<boolean> {
		try {
			await this.rc("rc/noop");
			return true;
		} catch {
			return false;
		}
	}

	async listRemotes(): Promise<string[]> {
		const { remotes } = await this.rc<{ remotes?: string[] }>("config/listremotes");
		return remotes ?? [];
	}

	/**
	 * Raw config, secrets included. Deliberately not exposed by any route —
	 * callers that show config to a user must use redactConfig().
	 */
	async remoteConfig(name: string): Promise<RcRemoteConfig> {
		return this.rc<RcRemoteConfig>("config/get", { name });
	}

	/** Safe to send to a browser: identifies the remote without revealing access to it. */
	async remoteConfigRedacted(name: string): Promise<RcRemoteConfig> {
		return redactConfig(await this.remoteConfig(name));
	}

	async remotesWithTypes(): Promise<RcRemote[]> {
		const dump = await this.rc<Record<string, { type?: string }>>("config/dump");
		return Object.entries(dump).map(([name, cfg]) => ({ name, type: cfg.type ?? "unknown" }));
	}

	/**
	 * Creates or replaces a remote. `parameters` are provider fields —
	 * for s3: provider, access_key_id, secret_access_key, endpoint, region.
	 */
	async createRemote(name: string, type: string, parameters: Record<string, string>): Promise<void> {
		await this.rc("config/create", { name, type, parameters, opt: { obscure: true } });
	}

	/** Renames are not supported by rc; replace is create-over-the-same-name. */

	async deleteRemote(name: string): Promise<void> {
		await this.rc("config/delete", { name });
	}

	/**
	 * Proves the credentials work by asking the provider for real information.
	 *
	 * `about` is the right probe: it is one cheap call that requires successful
	 * authentication AND that the bucket exists, so a typo in either fails here
	 * rather than silently at the first upload an hour later. Not every backend
	 * implements it, so a listing is the fallback.
	 */
	async testRemote(name: string, path = ""): Promise<{ ok: true; about: RcAbout } | { ok: false; error: string }> {
		const fs = `${name}:${path}`;
		// Deliberately short. This runs inside the request that adds a remote, and
		// a wrong credential should be reported in seconds rather than eventually.
		const PROBE_MS = 20_000;
		try {
			const about = await this.rc<RcAbout>("operations/about", { fs }, PROBE_MS);
			return { ok: true, about };
		} catch (err) {
			if (!(err instanceof RcloneError)) throw err;
			try {
				await this.rc("operations/list", { fs, remote: "", opt: { recurse: false } }, PROBE_MS);
				return { ok: true, about: {} };
			} catch (listErr) {
				return { ok: false, error: (listErr as RcloneError).message };
			}
		}
	}

	/**
	 * Starts a transfer and returns immediately with a job id.
	 *
	 * `_async` is not optional: a multi-gigabyte upload would otherwise hold the
	 * HTTP request open for hours, and any proxy timeout in between would make it
	 * look like it failed while it carried on running.
	 *
	 * `_group` names the job's stats bucket so progress can be read per upload
	 * rather than as one global number.
	 *
	 * A DIRECTORY and a FILE need different endpoints. sync/copy takes two
	 * directories and refuses a file with "is a file not a directory";
	 * operations/copyfile takes a parent plus a leaf on each side. Getting this
	 * wrong fails at the provider, not at validation, so the caller states which
	 * it has rather than letting rclone guess.
	 */
	async copyDir(opts: { srcFs: string; dstFs: string; group: string }): Promise<number> {
		const { jobid } = await this.rc<{ jobid: number }>("sync/copy", {
			srcFs: opts.srcFs,
			dstFs: opts.dstFs,
			createEmptySrcDirs: false,
			_async: true,
			_group: opts.group,
		});
		return jobid;
	}

	async copyFile(opts: {
		srcFs: string;
		srcRemote: string;
		dstFs: string;
		dstRemote: string;
		group: string;
	}): Promise<number> {
		const { jobid } = await this.rc<{ jobid: number }>("operations/copyfile", {
			srcFs: opts.srcFs,
			srcRemote: opts.srcRemote,
			dstFs: opts.dstFs,
			dstRemote: opts.dstRemote,
			_async: true,
			_group: opts.group,
		});
		return jobid;
	}

	/**
	 * One level of a remote, without recursing.
	 *
	 * `recurse: false` is not a default worth trusting here: a recursive list of
	 * a bucket holding a media library is thousands of round trips and, on a
	 * metered provider, a real bill.
	 */
	async listPath(fs: string, remote: string): Promise<RcListEntry[]> {
		const { list } = await this.rc<{ list?: RcListEntry[] }>(
			"operations/list",
			{ fs, remote, opt: { recurse: false } },
			30_000,
		);
		return list ?? [];
	}

	async jobStatus(jobid: number): Promise<RcJobStatus> {
		return this.rc<RcJobStatus>("job/status", { jobid });
	}

	async stopJob(jobid: number): Promise<void> {
		await this.rc("job/stop", { jobid });
	}

	async groupStats(group: string): Promise<RcTransferStats> {
		return this.rc<RcTransferStats>("core/stats", { group });
	}

	async version(): Promise<string> {
		const { version } = await this.rc<{ version?: string }>("core/version");
		return version ?? "unknown";
	}
}

/**
 * Fields that grant access rather than describe the remote.
 *
 * An allowlist would be safer than a denylist, but the field set differs per
 * backend and a wrong allowlist hides useful detail rather than leaking. So:
 * deny by name, and deny anything whose name contains a secret-ish word, which
 * covers backends this file has never heard of.
 */
const SECRET_FIELDS = new Set([
	"secret_access_key",
	"session_token",
	"pass",
	"password",
	"token",
	"client_secret",
	"key",
	"sas_url",
	"service_principal_file",
]);

const looksSecret = (k: string) => /secret|password|token|_key$|^pass/i.test(k);

export function redactConfig(cfg: RcRemoteConfig): RcRemoteConfig {
	const out: RcRemoteConfig = {};
	for (const [k, v] of Object.entries(cfg)) {
		out[k] = SECRET_FIELDS.has(k) || looksSecret(k) ? (v ? "••••••••" : "") : v;
	}
	return out;
}

export const rclone = new RcloneClient();

/** Logged once at boot so a misconfigured RCLONE_URL is visible immediately. */
export async function logRcloneAvailability(): Promise<void> {
	if (await rclone.reachable()) {
		logger.info({ version: await rclone.version().catch(() => "unknown") }, "rclone remote control available");
	} else {
		logger.info("rclone remote control not reachable - external storage disabled");
	}
}
