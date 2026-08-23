import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";

/**
 * Nightly `pg_dump`, gzipped, with a rolling retention window.
 *
 * Uses the real pg_dump rather than dumping rows from the app: only pg_dump
 * captures sequences, constraints, indexes and the pgboss schema, and a "backup"
 * that silently omits them is worse than none — you find out at restore time.
 *
 * The client MAJOR version must be >= the server's, so the image installs
 * postgresql-client-18 from PGDG. When it is missing this logs loudly and gives
 * up rather than writing a truncated file that looks like a backup.
 */

const RETAIN = 7;

export async function backupHandler() {
	const dir = env.BACKUP_DIR;
	await mkdir(dir, { recursive: true });

	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const target = path.join(dir, `cloudtorrent-${stamp}.sql.gz`);

	const child = spawn("pg_dump", ["--no-owner", "--no-privileges", "--clean", "--if-exists", env.DATABASE_URL], {
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stderr = "";
	child.stderr.on("data", (d: Buffer) => {
		stderr += d.toString();
	});

	const failed = await new Promise<string | null>((resolve) => {
		child.on("error", (err) => resolve(err.message));
		child.on("close", (code) => resolve(code === 0 ? null : `pg_dump exited ${code}: ${stderr.slice(0, 400)}`));
		// Stream straight to disk: never buffer a dump in memory on a 1 GB box.
		pipeline(child.stdout, createGzip(), createWriteStream(target)).catch((err) => resolve(String(err)));
	});

	if (failed) {
		logger.error({ err: failed, target }, "database backup FAILED");
		// A zero-length or partial file must not masquerade as a backup.
		await unlink(target).catch(() => {});
		return;
	}

	const { size } = await stat(target);
	if (size === 0) {
		logger.error({ target }, "database backup produced an empty file - discarding");
		await unlink(target).catch(() => {});
		return;
	}

	logger.info({ target, bytes: size }, "database backup written");
	await pruneOldBackups(dir);
}

async function pruneOldBackups(dir: string) {
	try {
		const files = (await readdir(dir))
			.filter((f) => f.startsWith("cloudtorrent-") && f.endsWith(".sql.gz"))
			.sort()
			.reverse();

		for (const old of files.slice(RETAIN)) {
			await unlink(path.join(dir, old)).catch(() => {});
			logger.debug({ file: old }, "pruned old backup");
		}
	} catch (err) {
		logger.warn({ err }, "could not prune old backups");
	}
}
