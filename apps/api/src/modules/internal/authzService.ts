import { logger } from "@/common/utils/logger";
import { checkEgress } from "@/modules/egress/egressGuard";
import { verifyDownloadToken } from "@/modules/file/downloadToken";
import { resolveRealPath } from "@/modules/file/filePath";
import { fileRepository } from "@/modules/file/fileRepository";
import { isShareIdShape } from "@/modules/share/shareId";
import { shareRepository } from "@/modules/share/shareRepository";
import { shareState } from "@/modules/share/shareState";

/**
 * The authorisation decision behind every /dl request. Caddy calls this via
 * forward_auth and serves bytes only on a 200 carrying X-Accel-Path.
 *
 * Fails CLOSED: any unexpected condition denies. If this service is down Caddy
 * cannot reach it and returns 502 — no bytes either way (verified in Phase 0).
 *
 * The client is told nothing beyond "denied". Reasons go to the log only: a
 * caller must not be able to tell "expired token" from "no such file" and use
 * the difference to probe.
 */

export type AuthzDecision =
	// `shareId` rides on the refusal too, so a denial can be attributed to the
	// share that caused it. Without it, refused attempts on a leaked link were
	// invisible — which is the one case you most want a record of.
	| { allow: true; accelPath: string; fileId: string | null; sizeBytes: number; shareId?: string }
	| { allow: false; reason: string; shareId?: string };

const DL_PREFIX = "/dl/";

/** Pulls the token out of `/dl/<token>/<cosmetic-filename>`. */
export function extractToken(forwardedUri: string | undefined): string | null {
	if (!forwardedUri) return null;
	// Strip any query string before parsing; only the path matters.
	const pathOnly = forwardedUri.split("?")[0];
	if (!pathOnly.startsWith(DL_PREFIX)) return null;
	const rest = pathOnly.slice(DL_PREFIX.length);
	const token = rest.split("/")[0];
	return token ? decodeURIComponent(token) : null;
}

export async function authorizeDownload(opts: {
	forwardedUri?: string;
	forwardedMethod?: string;
}): Promise<AuthzDecision> {
	const method = (opts.forwardedMethod ?? "GET").toUpperCase();
	// Downloads are reads. Anything else is a client doing something odd.
	if (method !== "GET" && method !== "HEAD") return { allow: false, reason: `method ${method} not allowed` };

	const token = extractToken(opts.forwardedUri);
	if (!token) return { allow: false, reason: "no token in URI" };

	// ── share link ──────────────────────────────────────────────────────────
	// A share id is an opaque nanoid, not a JWT, so it is distinguishable by
	// shape. Being revocable is the whole point: a signed URL could only be
	// killed by rotating the secret and invalidating every other link at once.
	if (isShareIdShape(token)) {
		const decision = await authorizeShare(token);
		if (decision) return decision;
		// Not a share after all — fall through and try it as a download token.
	}

	// ── session download token ──────────────────────────────────────────────
	const verified = await verifyDownloadToken(token);
	if (!verified.ok) return { allow: false, reason: verified.expired ? "token expired" : "token invalid" };

	// ── browsed path ──
	// No DB row is involved, so containment is the ONLY thing standing between
	// the claim and the filesystem. resolveRealPath also collapses symlinks.
	if (verified.claims.filePath !== undefined) {
		const resolved = await resolveRealPath(verified.claims.filePath);
		if (!resolved.ok) {
			logger.error({ reason: resolved.reason }, "authz refused a browsed path outside the downloads root");
			return { allow: false, reason: "path outside downloads root" };
		}
		return { allow: true, accelPath: resolved.accelPath, fileId: null, sizeBytes: 0 };
	}

	// ── torrent file row ──
	const row = await fileRepository.findWithTorrent(verified.claims.fileId as string);
	if (!row) return { allow: false, reason: "file no longer exists" };

	// Re-checked here, not just at link time: a torrent can be evicted or a file
	// rechecked between issuing a 4-hour token and using it.
	if (!row.file.isComplete) return { allow: false, reason: "file incomplete" };

	const resolved = await resolveRealPath(row.file.path);
	if (!resolved.ok) {
		logger.error(
			{ fileId: row.file.id, reason: resolved.reason },
			"authz refused a path that escapes the downloads root",
		);
		return { allow: false, reason: "path outside downloads root" };
	}

	return { allow: true, accelPath: resolved.accelPath, fileId: row.file.id, sizeBytes: row.file.sizeBytes };
}

/** Returns null when the id is not a share at all, so the caller can fall through. */
async function authorizeShare(id: string): Promise<AuthzDecision | null> {
	const found = await shareRepository.findWithTarget(id);
	if (!found) return null;

	const { share, file } = found;

	const state = shareState(share);
	if (!state.active) return { allow: false, reason: `share ${state.reason}`, shareId: id };

	// The Oracle allowance guard. SHARE traffic only — owner downloads are never
	// blocked, because locking yourself out of your own files to protect a quota
	// is worse than the overage.
	const egress = await checkEgress();
	if (egress.blocked) {
		logger.error(
			{ shareId: id, monthToDateBytes: egress.monthToDateBytes },
			"refusing share download - monthly egress hard stop reached",
		);
		return { allow: false, reason: "monthly egress limit reached", shareId: id };
	}
	if (egress.level === "warn") {
		logger.warn({ monthToDateBytes: egress.monthToDateBytes }, "egress past the soft alert threshold");
	}
	if (!share.allowDownload) return { allow: false, reason: "share does not allow downloading", shareId: id };

	// Only file-scoped shares can serve bytes directly. A torrent-scoped share
	// is a landing page; its individual files are fetched through their own
	// links, which are minted only after the share itself is validated.
	if (!file) return { allow: false, reason: "share targets a torrent, not a single file", shareId: id };
	if (!file.isComplete) return { allow: false, reason: "shared file is incomplete", shareId: id };

	const resolved = await resolveRealPath(file.path);
	if (!resolved.ok) {
		logger.error({ shareId: id, reason: resolved.reason }, "authz refused a shared path outside the downloads root");
		return { allow: false, reason: "path outside downloads root", shareId: id };
	}

	return {
		allow: true,
		accelPath: resolved.accelPath,
		fileId: file.id,
		sizeBytes: file.sizeBytes,
		shareId: share.id,
	};
}
