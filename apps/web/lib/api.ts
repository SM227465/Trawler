import type { components } from "./api-schema";

/** Domain types come from the OpenAPI spec the API generates from its zod
 *  schemas — never hand-written. Regenerate with `pnpm gen:api`. */
export type Torrent = components["schemas"]["Torrent"] & {
	/** Present on every row; declared here until `pnpm gen:api` is re-run. */
	lastAccessedAt?: string | null;
};
export type PublicUser = components["schemas"]["PublicUser"];

export type TorrentStatus = Torrent["status"];

export interface Envelope<T> {
	success: boolean;
	message: string;
	responseObject: T;
	statusCode: number;
	code?: string;
	requestId?: string;
}

export interface Paginated<T> {
	items: T[];
	pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

export interface StorageStatus {
	disk: { totalBytes: number; freeBytes: number; usedBytes: number; usedPct: number } | null;
	settings: {
		budgetBytes: number;
		ttlHours: number;
		highWatermarkPct: number;
		lowWatermarkPct: number;
		enabled: boolean;
	};
	libraryBytes: number;
	pressure: { overBudget: boolean; overDisk: boolean; active: boolean };
	atRisk: { count: number; bytes: number; torrents: Array<{ id: string; name: string; sizeBytes: number }> };
}

export interface Share {
	id: string;
	scope: "file" | "torrent";
	torrentId: string | null;
	fileId: string | null;
	label: string | null;
	hasPassword: boolean;
	allowStream: boolean;
	allowDownload: boolean;
	maxBytes: number | null;
	bytesServed: number;
	requestCount: number;
	expiresAt: string | null;
	revokedAt: string | null;
	lastAccessedAt: string | null;
	createdAt: string;
	url: string;
	state: "active" | "revoked" | "expired" | "quota";
}

export interface CreateShareInput {
	fileId?: string;
	torrentId?: string;
	label?: string;
	password?: string;
	expiresInHours?: number | null;
	maxBytes?: number | null;
	allowDownload?: boolean;
	allowStream?: boolean;
}

export interface BatchResult {
	results: Array<{
		input: string;
		status: "added" | "duplicate" | "failed";
		id: string | null;
		name: string | null;
		error: string | null;
	}>;
	added: number;
	duplicates: number;
	failed: number;
}

export interface BrowseEntry {
	name: string;
	path: string;
	type: "dir" | "file";
	sizeBytes: number;
	modifiedAt: string;
	/** Present only when the path is a completed file of a tracked torrent. */
	fileId?: string;
}

export interface BrowseListing {
	path: string;
	parent: string | null;
	root: string;
	entries: BrowseEntry[];
}

export interface AuditEntry {
	id: number;
	action: string;
	targetType: string | null;
	targetId: string | null;
	ip: string | null;
	userAgent: string | null;
	metadata: Record<string, unknown> | null;
	at: string;
}

export interface ShareAccessEntry {
	id: number;
	kind: "view" | "download" | "denied" | "unlock_failed";
	status: number;
	reason: string | null;
	ip: string | null;
	userAgent: string | null;
	bytes: number;
	at: string;
}

export interface ShareAccess {
	summary: {
		views: number;
		downloads: number;
		denied: number;
		unlockFailed: number;
		visitors: number;
		lastAt: string | null;
	};
	entries: ShareAccessEntry[];
}

export interface ShareAccessFeedEntry extends ShareAccessEntry {
	shareId: string;
	shareLabel: string | null;
}

export interface ShareAccessFeedPage {
	entries: ShareAccessFeedEntry[];
	nextCursor: number | null;
}

export interface AuditPage {
	entries: AuditEntry[];
	nextCursor: number | null;
}

export interface WebdavAccess {
	enabled: boolean;
	url: string;
	username: string;
	password: string;
	readOnly: boolean;
}

export interface TransferSettings {
	dlLimitBps: number;
	upLimitBps: number;
	altEnabled: boolean;
	maxRatio: number;
	maxRatioEnabled: boolean;
	maxSeedingMinutes: number;
	maxSeedingTimeEnabled: boolean;
}

export interface SystemSample {
	t: number;
	cpuPct: number;
	perCorePct: number[];
	memUsedBytes: number;
	memTotalBytes: number;
	netRxBps: number;
	netTxBps: number;
	dlBps: number;
	upBps: number;
}

export interface SystemStatus {
	history: SystemSample[];
	latest: SystemSample | null;
	sampleIntervalMs: number;
	host: {
		platform: string;
		arch: string;
		cpuModel: string;
		cpuCount: number;
		load: { one: number; five: number; fifteen: number; perCore: number };
		uptimeSeconds: number;
	};
	memory: { totalBytes: number; freeBytes: number; usedBytes: number; source: "cgroup" | "host" };
	disk: { totalBytes: number; freeBytes: number; usedBytes: number; usedPct: number } | null;
	process: { uptimeSeconds: number; rssBytes: number; nodeVersion: string };
	services: { qbittorrent: { reachable: boolean; version: string | null } };
}

export interface DownloadLink {
	url: string;
	absoluteUrl: string;
	filename: string;
	sizeBytes: number;
	expiresAt: string;
	aria2c: string;
}

export interface TorrentFile {
	id: string;
	torrentId: string;
	qbtIndex: number;
	path: string;
	sizeBytes: number;
	progress: number;
	priority: number;
	isComplete: boolean;
	contentType: string | null;
}

const BASE = "/api/v1";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/**
 * The access token lives in memory only — never localStorage, which is
 * readable by any injected script. It is lost on reload and re-obtained from
 * the httpOnly refresh cookie, which is the point of the rotation design.
 */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const setAccessToken = (t: string | null) => {
	accessToken = t;
};
export const getAccessToken = () => accessToken;

async function refreshSession(): Promise<boolean> {
	if (refreshing) return refreshing;
	refreshing = (async () => {
		try {
			const res = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" });
			if (!res.ok) return false;
			const body = (await res.json()) as Envelope<{ accessToken: string }>;
			accessToken = body.responseObject?.accessToken ?? null;
			return Boolean(accessToken);
		} catch {
			return false;
		} finally {
			refreshing = null;
		}
	})();
	return refreshing;
}

async function raw(path: string, init: RequestInit): Promise<Response> {
	const headers = new Headers(init.headers);
	if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
	// FormData must keep the browser-generated multipart boundary.
	if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	return fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	let res = await raw(path, init);

	// One transparent refresh-and-retry. The 15-minute access token expiring
	// mid-session must never surface to the user.
	if (res.status === 401 && !path.startsWith("/auth/")) {
		if (await refreshSession()) res = await raw(path, init);
	}

	const body = (await res.json().catch(() => null)) as Envelope<T> | null;

	if (!res.ok || !body?.success) {
		throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status, body?.code);
	}
	return body.responseObject;
}

// ── endpoints ──────────────────────────────────────────────────────────────

export const api = {
	login: (email: string, password: string) =>
		apiFetch<{ accessToken: string; user: PublicUser }>("/auth/login", {
			method: "POST",
			body: JSON.stringify({ email, password }),
		}),

	logout: () => apiFetch<null>("/auth/logout", { method: "POST" }),

	me: () => apiFetch<PublicUser>("/auth/me"),

	listTorrents: (params: { status?: string; q?: string; limit?: number; offset?: number } = {}) => {
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
		const suffix = qs.toString() ? `?${qs}` : "";
		return apiFetch<Paginated<Torrent>>(`/torrents${suffix}`);
	},

	getTorrent: (id: string) => apiFetch<Torrent>(`/torrents/${id}`),

	addTorrent: (magnet: string) => apiFetch<Torrent>("/torrents", { method: "POST", body: JSON.stringify({ magnet }) }),

	addMagnets: (magnets: string[]) =>
		apiFetch<BatchResult>("/torrents/batch", { method: "POST", body: JSON.stringify({ magnets }) }),

	addTorrentFiles: (files: File[]) => {
		const form = new FormData();
		for (const f of files) form.append("torrents", f);
		return apiFetch<BatchResult>("/torrents/files", { method: "POST", body: form });
	},

	addTorrentFile: (file: File) => {
		const form = new FormData();
		form.append("torrent", file);
		// No content-type header — the browser sets the multipart boundary.
		return apiFetch<Torrent>("/torrents/file", { method: "POST", body: form });
	},

	torrentFiles: (id: string) => apiFetch<TorrentFile[]>(`/torrents/${id}/files`),

	fileLink: (fileId: string) => apiFetch<DownloadLink>(`/files/${fileId}/link`),

	storage: () => apiFetch<StorageStatus>("/storage"),

	listShares: () => apiFetch<Share[]>("/shares"),

	createShare: (input: CreateShareInput) => apiFetch<Share>("/shares", { method: "POST", body: JSON.stringify(input) }),

	revokeShare: (id: string) => apiFetch<Share>(`/shares/${id}`, { method: "DELETE" }),

	system: () => apiFetch<SystemStatus>("/system"),

	transferSettings: () => apiFetch<TransferSettings>("/settings/transfer"),

	webdav: () => apiFetch<WebdavAccess>("/settings/webdav"),

	browse: (path: string) => apiFetch<BrowseListing>(`/files/browse?path=${encodeURIComponent(path)}`),

	deleteBrowsePath: (path: string) =>
		apiFetch<{ path: string; type: "dir" | "file" }>(`/files/browse?path=${encodeURIComponent(path)}`, {
			method: "DELETE",
		}),

	browseLink: (path: string) =>
		apiFetch<{ path: string; url: string; filename: string; sizeBytes: number }>(
			`/files/browse/link?path=${encodeURIComponent(path)}`,
		),

	browseZipLink: (path: string) =>
		apiFetch<{ path: string; url: string; filename: string; fileCount: number; approxBytes: number }>(
			`/files/browse/zip-link?path=${encodeURIComponent(path)}`,
		),

	updateTransferSettings: (patch: Partial<TransferSettings>) =>
		apiFetch<TransferSettings>("/settings/transfer", { method: "PATCH", body: JSON.stringify(patch) }),

	runEviction: () => apiFetch<unknown>("/storage/evict", { method: "POST" }),

	shareAccess: (id: string) => apiFetch<ShareAccess>(`/shares/${id}/access`),

	shareAccessFeed: (opts: { limit?: number; before?: number; kind?: string } = {}) => {
		const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
		if (opts.before !== undefined) q.set("before", String(opts.before));
		if (opts.kind) q.set("kind", opts.kind);
		return apiFetch<ShareAccessFeedPage>(`/audit/shares?${q}`);
	},

	audit: (opts: { limit?: number; before?: number; action?: string } = {}) => {
		const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
		if (opts.before !== undefined) q.set("before", String(opts.before));
		if (opts.action) q.set("action", opts.action);
		return apiFetch<AuditPage>(`/audit?${q}`);
	},

	updateStorageSettings: (patch: Partial<StorageStatus["settings"]>) =>
		apiFetch<StorageStatus["settings"]>("/storage/settings", {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),

	action: (id: string, verb: "pause" | "resume" | "recheck" | "pin" | "unpin") =>
		apiFetch<null>(`/torrents/${id}/${verb}`, { method: "POST" }),

	removeTorrent: (id: string, deleteFiles: boolean) =>
		apiFetch<null>(`/torrents/${id}?deleteFiles=${deleteFiles}`, { method: "DELETE" }),
};

export { refreshSession };
