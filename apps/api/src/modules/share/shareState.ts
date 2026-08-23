/**
 * THE single definition of whether a share is usable. Doc 03 §A10 lists this as
 * non-negotiable: if this logic is duplicated anywhere, one copy will drift and
 * a revoked link will keep serving.
 *
 * Pure and synchronous so the whole matrix is testable without a database.
 */

export interface ShareLike {
	revokedAt: Date | null;
	expiresAt: Date | null;
	maxBytes: number | null;
	bytesServed: number;
}

export type ShareInactiveReason = "revoked" | "expired" | "quota";

export type ShareState = { active: true } | { active: false; reason: ShareInactiveReason };

/**
 * Can this share serve a request RIGHT NOW?
 *
 * Order matters for the message the caller shows: revoked is a deliberate act,
 * expired is time, quota is usage. A revoked share reports "revoked" even if it
 * also expired, because that is the fact the owner acted on.
 */
export function shareState(share: ShareLike, now: Date = new Date()): ShareState {
	if (share.revokedAt !== null) return { active: false, reason: "revoked" };
	if (share.expiresAt !== null && share.expiresAt.getTime() <= now.getTime()) {
		return { active: false, reason: "expired" };
	}
	if (share.maxBytes !== null && share.bytesServed >= share.maxBytes) {
		return { active: false, reason: "quota" };
	}
	return { active: true };
}

export const isActive = (share: ShareLike, now?: Date): boolean => shareState(share, now).active;

/**
 * Does this share protect its torrent from cleanup?
 *
 * DELIBERATELY BROADER than `isActive`: quota exhaustion does NOT release the
 * protection. A share that has served its byte budget is one settings change
 * away from working again, and deleting the files underneath it would make that
 * unrecoverable. Revocation and expiry are terminal; a spent quota is not.
 *
 * This is why doc 02 §4's eviction query checks only revoked_at and expires_at.
 * The two notions are different on purpose — do not "fix" one to match the other.
 */
export function protectsFromEviction(share: ShareLike, now: Date = new Date()): boolean {
	if (share.revokedAt !== null) return false;
	if (share.expiresAt !== null && share.expiresAt.getTime() <= now.getTime()) return false;
	return true;
}
