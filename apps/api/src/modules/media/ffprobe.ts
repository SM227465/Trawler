import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@/common/utils/logger";

const run = promisify(execFile);

/**
 * Bumped whenever ProbeResult gains a field worth having for files probed
 * before it existed. Older rows are probed again, a batch at a time.
 *
 * 2: profile, level, bit depth and frame rate — what the browser needs to be
 *    asked whether THIS device can decode the video.
 */
export const PROBE_VERSION = 2;

export interface ProbeResult {
	container: string | null;
	videoCodec: string | null;
	audioCodec: string | null;
	width: number | null;
	height: number | null;
	durationSeconds: number | null;
	bitrateBps: number | null;
	/** ffprobe's name for it: "High", "High 10", "Main 10", "Profile 0". */
	videoProfile: string | null;
	/** In the codec's own units: 31 for H.264 3.1, 120 for HEVC 4.0. */
	videoLevel: number | null;
	bitDepth: number | null;
	frameRate: number | null;
}

interface FfStream {
	codec_type?: string;
	codec_name?: string;
	width?: number;
	height?: number;
	profile?: string;
	level?: number;
	pix_fmt?: string;
	avg_frame_rate?: string;
	r_frame_rate?: string;
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
	return parseProbe(stdout);
}

/** ffprobe's JSON, reduced to what playback decisions need. */
export function parseProbe(stdout: string): ProbeResult {
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
		videoProfile: video?.profile ?? null,
		// VP9 reports -99 when the stream does not say.
		videoLevel: video?.level !== undefined && video.level > 0 ? video.level : null,
		bitDepth: bitDepthOf(video?.pix_fmt),
		frameRate: rateOf(video?.avg_frame_rate) ?? rateOf(video?.r_frame_rate),
	};
}

/** "yuv420p10le" → 10. A pixel format with no depth suffix is 8-bit. */
const bitDepthOf = (pixFmt: string | undefined) => {
	if (!pixFmt) return null;
	const m = pixFmt.match(/p(\d+)(?:le|be)$/);
	return m ? Number(m[1]) : 8;
};

/** "24000/1001" → 23.976. ffprobe writes "0/0" when it does not know. */
const rateOf = (fraction: string | undefined) => {
	const [n, d] = (fraction ?? "").split("/").map(Number);
	return n > 0 && d > 0 ? n / d : null;
};

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
