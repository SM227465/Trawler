import type { Request } from "express";
import { logger } from "@/common/utils/logger";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";

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
	| "settings.transfer"
	| "settings.storage"
	| "storage.evict";

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

export const audit = { record, recordFromRequest, requestContext };
