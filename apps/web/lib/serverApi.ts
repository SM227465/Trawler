import "server-only";

/**
 * SSR-side API access for the public share page.
 *
 * Separate from `lib/api.ts` because that one is browser code: it uses a
 * relative path through Caddy and carries the access token. This runs inside the
 * web container with no session at all, so it talks straight to the api service
 * on the compose network.
 */
const INTERNAL = process.env.INTERNAL_API_URL ?? "http://api:3000";

export interface PublicShare {
	id: string;
	state: "active";
	locked: boolean;
	label: string | null;
	name: string | null;
	sizeBytes: number | null;
	scope: "file" | "torrent";
	allowDownload: boolean;
	allowStream: boolean;
	/** ffprobe's verdict, withheld while the share is locked. */
	playback: "direct" | "remux" | "incompatible" | "not_media" | null;
	durationSeconds: number | null;
	expiresAt: string | null;
	bytesServed: number;
	maxBytes: number | null;
}

export type ShareDeadReason = "revoked" | "expired" | "quota" | "missing";

export type ShareLookup = { ok: true; share: PublicShare } | { ok: false; reason: ShareDeadReason };

/**
 * @param client forwarded from the incoming request. This page is server
 * rendered, so without it the API sees the WEB CONTAINER as the caller and
 * every share view was logged against 172.18.x.x — an address that tells you
 * nothing about who opened your link.
 */
export async function fetchPublicShare(
	id: string,
	cookie?: string,
	client?: { ip?: string; userAgent?: string; countAsView?: boolean },
): Promise<ShareLookup> {
	try {
		const headers: Record<string, string> = {};
		if (cookie) headers.cookie = cookie;
		if (client?.ip) headers["x-forwarded-for"] = client.ip;
		if (client?.userAgent) headers["user-agent"] = client.userAgent;
		// Next calls this twice per open — once for generateMetadata, once for the
		// page — so the view is counted explicitly by the page only. Opt-in, so a
		// future third caller cannot inflate the number by forgetting to opt out.
		if (client?.countAsView) headers["x-trawler-view"] = "1";

		const res = await fetch(`${INTERNAL}/api/v1/public/shares/${encodeURIComponent(id)}`, {
			headers,
			// A share's state changes the moment it is revoked — never cache it.
			cache: "no-store",
		});

		const body = (await res.json()) as {
			success: boolean;
			code?: string;
			responseObject?: PublicShare | { state?: string };
		};

		if (res.ok && body.success) return { ok: true, share: body.responseObject as PublicShare };

		const byCode: Record<string, ShareDeadReason> = {
			SHARE_REVOKED: "revoked",
			SHARE_EXPIRED: "expired",
			SHARE_QUOTA_EXCEEDED: "quota",
		};
		return { ok: false, reason: byCode[body.code ?? ""] ?? "missing" };
	} catch {
		return { ok: false, reason: "missing" };
	}
}
