import { and, desc, eq, lt } from "drizzle-orm";
import type { Request } from "express";
import { logger } from "@/common/utils/logger";
import { db } from "@/db/client";
import { auditLog, shareAccessLog, shares } from "@/db/schema";

/**
 * Owner-initiated state changes, recorded so "what happened to my box" has an
 * answer that outlives the thing it happened to.
 *
 * Distinct from share_access_log: that records anonymous READS of a share link,
 * this records WRITES by the account holder (and failed attempts to become one).
 *
 * Two rules this module exists to enforce:
 *
 *  1. Auditing NEVER breaks the audited action. Every write is fire-and-forget
 *     and swallows its own errors. A full disk or a locked table must not turn
 *     a successful delete into a 500 the user then retries.
 *  2. Only the OUTCOME is recorded, never the input that produced it. Nothing
 *     here should ever receive a password, token or magnet — pino already
 *     redacts those, and a durable table is a worse place to leak them.
 */

export type AuditAction =
	| "auth.login"
	| "auth.login_failed"
	| "auth.logout"
	| "torrent.add"
	| "torrent.remove"
	| "file.delete"
	| "share.create"
	| "share.revoke"
	| "share.clear"
	| "settings.transfer"
	| "settings.storage"
	| "storage.evict"
	| "storage.remote.add"
	| "storage.remote.remove"
	| "audit.clear";

export interface AuditEntry {
	action: AuditAction;
	actorId?: string | null;
	targetType?: string | null;
	targetId?: string | null;
	metadata?: Record<string, unknown> | null;
	ip?: string | null;
	userAgent?: string | null;
}

/**
 * Behind Caddy every request arrives from the compose network, so req.ip is
 * always the proxy. X-Forwarded-For's first entry is the real client.
 */
export function requestContext(req: Request): Pick<AuditEntry, "ip" | "userAgent"> {
	return {
		ip: req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? req.ip ?? null,
		userAgent: req.header("User-Agent")?.slice(0, 300) ?? null,
	};
}

/** Fire-and-forget. Deliberately returns void — callers must not await it. */
export function record(entry: AuditEntry): void {
	void db
		.insert(auditLog)
		.values({
			actorId: entry.actorId ?? null,
			action: entry.action,
			targetType: entry.targetType ?? null,
			targetId: entry.targetId ?? null,
			ip: entry.ip ?? null,
			userAgent: entry.userAgent ?? null,
			metadata: entry.metadata ?? null,
		})
		.catch((err) => logger.error({ err, action: entry.action }, "audit write failed"));
}

/** Convenience for the common case: an authenticated request that succeeded. */
export function recordFromRequest(req: Request, entry: Omit<AuditEntry, "ip" | "userAgent">): void {
	record({ ...entry, ...requestContext(req), actorId: entry.actorId ?? req.user?.id ?? null });
}

/**
 * Recent entries, newest first, with keyset pagination.
 *
 * Cursors on `id`, not `at`: id is a bigserial so it is strictly monotonic and
 * unique, while several rows can share a timestamp — an OFFSET or an `at`
 * cursor would skip or repeat entries as new ones arrive mid-scroll, which is
 * exactly wrong for a log you are reading to work out what happened.
 */
export async function list(opts: { limit?: number; before?: number; action?: string } = {}) {
	const capped = Math.min(Math.max(opts.limit ?? 50, 1), 200);

	const filters = [
		opts.before !== undefined ? lt(auditLog.id, opts.before) : undefined,
		opts.action ? eq(auditLog.action, opts.action) : undefined,
	].filter((f) => f !== undefined);

	// One extra row tells us whether another page exists without a COUNT.
	const rows = await db
		.select({
			id: auditLog.id,
			action: auditLog.action,
			targetType: auditLog.targetType,
			targetId: auditLog.targetId,
			ip: auditLog.ip,
			userAgent: auditLog.userAgent,
			metadata: auditLog.metadata,
			at: auditLog.at,
		})
		.from(auditLog)
		.where(filters.length ? and(...filters) : undefined)
		.orderBy(desc(auditLog.id))
		.limit(capped + 1);

	const entries = rows.slice(0, capped);
	return {
		entries,
		nextCursor: rows.length > capped ? (entries.at(-1)?.id ?? null) : null,
	};
}

export interface AuditRow {
	id: number;
	action: string;
	targetType: string | null;
	targetId: string | null;
	ip: string | null;
	userAgent: string | null;
	metadata: unknown;
	at: Date;
}

/**
 * Share access across every share, newest first — the other half of "what
 * happened here". audit_log records what the OWNER did; this is what strangers
 * did with the links the owner handed out, so it lives in its own table with
 * its own sequence and gets its own keyset rather than being unioned into one.
 */
export async function listShareAccess(opts: { limit?: number; before?: number; kind?: string } = {}) {
	const capped = Math.min(Math.max(opts.limit ?? 50, 1), 200);

	const filters = [
		opts.before !== undefined ? lt(shareAccessLog.id, opts.before) : undefined,
		opts.kind ? eq(shareAccessLog.kind, opts.kind as "view" | "download" | "denied" | "unlock_failed") : undefined,
	].filter((f) => f !== undefined);

	const rows = await db
		.select({
			id: shareAccessLog.id,
			shareId: shareAccessLog.shareId,
			// The label is what the owner named it; the id alone means nothing to
			// them a week later.
			shareLabel: shares.label,
			kind: shareAccessLog.kind,
			status: shareAccessLog.status,
			reason: shareAccessLog.reason,
			ip: shareAccessLog.ip,
			userAgent: shareAccessLog.userAgent,
			bytes: shareAccessLog.bytes,
			at: shareAccessLog.at,
		})
		.from(shareAccessLog)
		.leftJoin(shares, eq(shares.id, shareAccessLog.shareId))
		.where(filters.length ? and(...filters) : undefined)
		.orderBy(desc(shareAccessLog.id))
		.limit(capped + 1);

	const entries = rows.slice(0, capped);
	return { entries, nextCursor: rows.length > capped ? (entries.at(-1)?.id ?? null) : null };
}

/**
 * Empties one of the two logs.
 *
 * Deliberate tension, resolved deliberately: a log the app can erase is weaker
 * evidence than one it cannot. But this is a single-owner appliance, the owner
 * is the only actor, and a history they cannot clear is a privacy problem
 * rather than a security feature.
 *
 * The clear itself is written back into audit_log immediately afterwards, with
 * the row count. So the trail can be emptied but never silently — "cleared 412
 * entries" is always the first thing left behind.
 */
export async function clear(target: "audit" | "shares"): Promise<number> {
	if (target === "shares") {
		const res = await db.delete(shareAccessLog);
		return res.rowCount ?? 0;
	}
	const res = await db.delete(auditLog);
	return res.rowCount ?? 0;
}

export const audit = { record, recordFromRequest, requestContext, list, listShareAccess, clear };
