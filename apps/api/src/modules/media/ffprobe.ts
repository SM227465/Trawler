import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@/common/utils/logger";

const run = promisify(execFile);

export interface ProbeResult {
	container: string | null;
	videoCodec: string | null;
	audioCodec: string | null;
	width: number | null;
	height: number | null;
	durationSeconds: number | null;
	bitrateBps: number | null;
}

interface FfStream {
	codec_type?: string;
	codec_name?: string;
	width?: number;
	height?: number;
}

interface FfFormat {
	format_name?: string;
	duration?: string;
	bit_rate?: string;
}

/**
 * Reads what a file actually contains.
 *
 * ffprobe only, never ffmpeg: this must not decode a frame. It reads headers
 * and exits, so it costs milliseconds even for a 20 GB file — which matters on
 * a box whose CPU is mostly stolen.
 *
 * -analyzeduration and -probesize are capped for the same reason. The defaults
 * will read many megabytes looking for streams in an awkward file; the first
 * few are enough to name the codecs, and being wrong here downgrades playback
 * rather than breaking it.
 */
export async function probeFile(absPath: string, timeoutMs = 20_000): Promise<ProbeResult> {
	const { stdout } = await run(
		"ffprobe",
		[
			"-v",
			"error",
			"-analyzeduration",
			"5M",
			"-probesize",
			"5M",
			"-print_format",
			"json",
			"-show_format",
			"-show_streams",
			absPath,
		],
		{ timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
	);

	const parsed = JSON.parse(stdout) as { streams?: FfStream[]; format?: FfFormat };
	const streams = parsed.streams ?? [];
	const video = streams.find((s) => s.codec_type === "video");
	const audio = streams.find((s) => s.codec_type === "audio");

	const num = (v: string | undefined) => {
		const n = Number(v);
		return Number.isFinite(n) && n > 0 ? n : null;
	};

	return {
		container: parsed.format?.format_name ?? null,
		videoCodec: video?.codec_name ?? null,
		audioCodec: audio?.codec_name ?? null,
		width: video?.width ?? null,
		height: video?.height ?? null,
		durationSeconds: num(parsed.format?.duration),
		bitrateBps: num(parsed.format?.bit_rate),
	};
}

/** True when ffprobe/ffmpeg are actually present, so features can hide rather than fail. */
export async function ffmpegAvailable(): Promise<boolean> {
	try {
		await run("ffprobe", ["-version"], { timeout: 5000 });
		return true;
	} catch (err) {
		logger.warn({ err }, "ffprobe not available - probing and remux are disabled");
		return false;
	}
}
