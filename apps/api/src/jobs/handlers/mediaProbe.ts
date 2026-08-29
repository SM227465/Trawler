import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { resolveRealPath } from "@/modules/file/filePath";
import { ffmpegAvailable, probeFile } from "@/modules/media/ffprobe";
import { mediaRepository } from "@/modules/media/mediaRepository";
import { decidePlayback } from "@/modules/media/playback";

/**
 * Works through files that have never been probed.
 *
 * A small batch on a schedule rather than a job per file: ffprobe is cheap but
 * not free, and a finished 40-file torrent would otherwise queue 40 jobs at
 * once on a box with a quarter of a CPU.
 *
 * A failure is RECORDED, not retried forever. A file ffprobe cannot read will
 * not become readable, and a row with probe_error set keeps it out of the
 * unprobed query — otherwise every pass would pick up the same broken file.
 */
const BATCH = 8;

export async function mediaProbeHandler() {
	if (!(await ffmpegAvailable())) return { probed: 0, skipped: "ffprobe unavailable" };

	const files = await mediaRepository.unprobed(BATCH);
	if (files.length === 0) return { probed: 0 };

	let probed = 0;
	for (const f of files) {
		const resolved = await resolveRealPath(f.path);
		if (!resolved.ok) {
			await mediaRepository.upsert({ fileId: f.id, playback: "not_media", probeError: "path is not readable" });
			continue;
		}

		try {
			const result = await probeFile(resolved.absPath);
			await mediaRepository.upsert({
				fileId: f.id,
				container: result.container,
				videoCodec: result.videoCodec,
				audioCodec: result.audioCodec,
				width: result.width,
				height: result.height,
				durationSeconds: result.durationSeconds,
				bitrateBps: result.bitrateBps,
				playback: decidePlayback(result),
				probeError: null,
			});
			probed++;
		} catch (err) {
			// Recorded so it is not retried on every pass. Not an error worth
			// shouting about: subtitles, NFO files and archives all land here.
			await mediaRepository.upsert({
				fileId: f.id,
				playback: "not_media",
				probeError: (err as Error).message.slice(0, 300),
			});
			logger.debug({ err, fileId: f.id, path: f.path }, "probe failed");
		}
	}

	if (probed > 0) logger.info({ probed, root: env.DOWNLOADS_DIR }, "media probed");
	return { probed };
}
