import { stat } from "node:fs/promises";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { rclone } from "@/integrations/rclone/client";
import { resolveRealPath } from "@/modules/file/filePath";
import { remoteRepository } from "@/modules/remote/remoteRepository";
import { remoteFs } from "@/modules/remote/remoteService";
import { uploadRepository } from "./uploadRepository";

/** rclone addresses the local side by a real path inside its own container. */
const LOCAL_ROOT = env.DOWNLOADS_DIR;

/** Drizzle wraps driver errors, so the SQLSTATE lives one level down. */
function pgErrorCode(err: unknown): string | undefined {
	const direct = (err as { code?: string }).code;
	if (direct) return direct;
	return (err as { cause?: { code?: string } }).cause?.code;
}

/** Stats are bucketed per upload so progress is per-transfer, not global. */
export const groupFor = (id: string) => `upload/${id}`;

class UploadService {
	/**
	 * Queues a copy of one path to a remote.
	 *
	 * Validates the path the same way browsing and downloading do — traversal and
	 * symlink escapes refused before anything is queued, because this one hands a
	 * path to a process that will read whatever it is given.
	 */
	async queue(remoteName: string, rawPath: string) {
		const meta = await remoteRepository.get(remoteName);
		if (!meta) {
			return ServiceResponse.failure("No such storage", null, ErrorCode.RESOURCE_NOT_FOUND, "REMOTE_NOT_FOUND");
		}

		const rel = (rawPath ?? "").replace(/^\/+/, "");
		if (!rel) {
			return ServiceResponse.failure("Nothing to upload", null, ErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");
		}

		const resolved = await resolveRealPath(rel);
		if (!resolved.ok) {
			logger.warn({ rawPath, reason: resolved.reason }, "upload refused");
			return ServiceResponse.failure("Path not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}

		// Mirrors the source layout under the remote's prefix, so a bucket shared
		// with other things stays navigable.
		const dstFs = `${remoteFs(remoteName, meta.bucket, meta.prefix)}/${rel}`.replace(/\/+$/, "");

		try {
			const [row] = await uploadRepository.create({
				id: uuidv7(),
				remoteName,
				srcPath: rel,
				dstFs,
				status: "queued",
			});
			return ServiceResponse.success("Upload queued", row);
		} catch (err) {
			// The partial unique index rejects a second live upload of the same
			// path. That is the intended answer, not an error worth 500ing over.
			//
			// The code is on err.cause, not err: drizzle wraps the driver error in
			// its own, so checking err.code silently never matched and a duplicate
			// came back as a 500.
			if (pgErrorCode(err) === "23505") {
				return ServiceResponse.failure(
					"That is already uploading",
					null,
					ErrorCode.VALIDATION_ERROR,
					"UPLOAD_IN_PROGRESS",
				);
			}
			throw err;
		}
	}

	/**
	 * Starts the rclone transfer for a queued row.
	 *
	 * Called by the job handler. Returns immediately — rclone runs the copy
	 * asynchronously and progress is read back from its stats, so nothing here
	 * holds a worker slot for the length of a multi-gigabyte transfer.
	 */
	async start(id: string): Promise<void> {
		const row = await uploadRepository.claim(id);
		if (!row) return; // already running, or cancelled before it began

		try {
			// rclone needs different endpoints for a file and a directory, and it
			// will not work it out for us. Resolve again here rather than trusting
			// what was true at queue time — a torrent can finish, or be deleted,
			// between the two.
			const resolved = await resolveRealPath(row.srcPath);
			if (!resolved.ok) throw new Error("The source no longer exists");
			const isDir = (await stat(resolved.absPath)).isDirectory();

			const group = groupFor(row.id);
			const jobid = isDir
				? await rclone.copyDir({
						srcFs: `${LOCAL_ROOT}/${row.srcPath}`,
						dstFs: row.dstFs,
						group,
					})
				: await rclone.copyFile({
						// Parent plus leaf on each side, which is what copyfile takes.
						srcFs: path.posix.join(LOCAL_ROOT, path.posix.dirname(row.srcPath)),
						srcRemote: path.posix.basename(row.srcPath),
						dstFs: row.dstFs.slice(0, row.dstFs.lastIndexOf("/")),
						dstRemote: row.dstFs.slice(row.dstFs.lastIndexOf("/") + 1),
						group,
					});
			await uploadRepository.update(row.id, { rcloneJobId: jobid });
			logger.info({ uploadId: row.id, jobid, dst: row.dstFs }, "upload started");
		} catch (err) {
			await uploadRepository.update(row.id, {
				status: "failed",
				error: (err as Error).message.slice(0, 500),
				finishedAt: new Date(),
			});
			logger.error({ err, uploadId: row.id }, "upload could not start");
		}
	}

	/**
	 * Rows plus live progress.
	 *
	 * Progress comes from rclone rather than the database because it changes
	 * every second and persisting that would be a write per second per transfer.
	 * The database holds what must survive a restart; rclone holds what is
	 * happening right now.
	 */
	async list() {
		const rows = await uploadRepository.recent(50);
		const live = rows.filter((r) => r.status === "running");

		const stats = new Map<string, { bytes: number; speed: number; eta: number | null }>();
		await Promise.all(
			live.map(async (r) => {
				try {
					const s = await rclone.groupStats(groupFor(r.id));
					stats.set(r.id, { bytes: s.bytes ?? 0, speed: s.speed ?? 0, eta: s.eta ?? null });
				} catch {
					/* rclone restarted or the group has expired — fall back to the row */
				}
			}),
		);

		return ServiceResponse.success(
			"Uploads",
			rows.map((r) => {
				const s = stats.get(r.id);
				return {
					...r,
					bytesDone: s ? Math.max(r.bytesDone, s.bytes) : r.bytesDone,
					speedBps: s?.speed ?? 0,
					etaSeconds: s?.eta ?? null,
				};
			}),
		);
	}

	async cancel(id: string) {
		const row = await uploadRepository.byId(id);
		if (!row) return ServiceResponse.failure("Not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		if (row.status !== "queued" && row.status !== "running") {
			return ServiceResponse.success("Already finished", row);
		}

		if (row.rcloneJobId !== null) await rclone.stopJob(row.rcloneJobId).catch(() => undefined);
		const [updated] = await uploadRepository.update(id, { status: "cancelled", finishedAt: new Date() });
		logger.info({ uploadId: id }, "upload cancelled - partial data at the remote is left alone");
		return ServiceResponse.success("Cancelled", updated);
	}

	async clearFinished() {
		const removed = await uploadRepository.clearFinished();
		return ServiceResponse.success("Cleared", { removed });
	}
}

export const uploadService = new UploadService();
