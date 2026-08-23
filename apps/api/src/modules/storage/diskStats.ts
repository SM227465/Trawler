import { statfs } from "node:fs/promises";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";

export interface DiskStats {
	totalBytes: number;
	freeBytes: number;
	usedBytes: number;
	usedPct: number;
}

/**
 * DELIBERATE DEVIATION from plan item 6.3, which said to read qBittorrent's
 * `server_state.free_space_on_disk`.
 *
 * That field gives FREE bytes only, and a percentage watermark needs the TOTAL
 * too — which qBittorrent never reports. statfs() gives both from the same
 * filesystem qBittorrent writes to (the worker mounts the identical volume), so
 * it is one source instead of two, and it keeps eviction working even when
 * qBittorrent is wedged.
 */
export async function getDiskStats(): Promise<DiskStats> {
	const fsStats = await statfs(env.DOWNLOADS_DIR);

	const totalBytes = fsStats.blocks * fsStats.bsize;
	// bavail, not bfree: bfree counts root-reserved blocks we cannot actually use.
	const freeBytes = fsStats.bavail * fsStats.bsize;
	const usedBytes = totalBytes - freeBytes;

	return {
		totalBytes,
		freeBytes,
		usedBytes,
		usedPct: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
	};
}

export async function safeDiskStats(): Promise<DiskStats | null> {
	try {
		return await getDiskStats();
	} catch (err) {
		logger.error({ err, dir: env.DOWNLOADS_DIR }, "could not stat the downloads filesystem");
		return null;
	}
}
