import { spawn } from "node:child_process";
import type { Response } from "express";
import { logger } from "@/common/utils/logger";

/**
 * Remuxing: repackage a stream a browser refuses into one it accepts, without
 * re-encoding a single frame.
 *
 * `-c:v copy` is the whole point. The video is passed through byte for byte, so
 * an MKV holding H.264 becomes a playable MP4 for the cost of moving bytes, not
 * decoding them. Only the audio is re-encoded, and only when it has to be.
 *
 * THIS IS THE ONE PLACE BYTES FLOW THROUGH NODE. Everywhere else Caddy serves
 * files directly, deliberately. There is no alternative here: the output does
 * not exist on disk, it is produced as it is sent. Node only pipes it — it
 * never buffers the stream, so memory stays flat regardless of file size.
 */

/**
 * Hard ceiling on concurrent remuxes.
 *
 * Two is not conservatism, it is arithmetic: this box has two cores and most of
 * their time is already taken by the hypervisor. A third stream would not be
 * slower, it would make all three stutter and starve the torrent client at the
 * same time. Requests past the limit are refused with a clear reason rather
 * than queued, because a video that starts in four minutes is not playback.
 */
const MAX_CONCURRENT = 2;
let active = 0;

export const remuxCapacity = () => ({ active, max: MAX_CONCURRENT, free: MAX_CONCURRENT - active });

export interface RemuxOptions {
	absPath: string;
	/** Seconds to start from. Seeking restarts ffmpeg at the new offset. */
	startSeconds?: number;
	/** Re-encode audio only when the source codec is one MP4 cannot carry. */
	audioCodec: string | null;
}

const MP4_SAFE_AUDIO = new Set(["aac", "mp3"]);

export function buildArgs(opts: RemuxOptions): string[] {
	const args: string[] = [];

	// BEFORE -i, not after: this makes ffmpeg seek by moving the read head to
	// the nearest keyframe rather than decoding and discarding everything up to
	// the offset. On a two-hour file that is the difference between instant and
	// a minute of pegged CPU.
	if (opts.startSeconds && opts.startSeconds > 0) {
		args.push("-ss", String(Math.floor(opts.startSeconds)));
	}

	args.push("-i", opts.absPath);

	// Video is never touched.
	args.push("-c:v", "copy");

	// Audio only if the source cannot live in an MP4.
	if (opts.audioCodec && MP4_SAFE_AUDIO.has(opts.audioCodec)) {
		args.push("-c:a", "copy");
	} else {
		args.push("-c:a", "aac", "-b:a", "160k", "-ac", "2");
	}

	args.push(
		"-movflags",
		"frag_keyframe+empty_moov+default_base_moof",
		"-f",
		"mp4",
		// Subtitles cannot go into a fragmented MP4 and their presence aborts the
		// mux, so they are dropped rather than allowed to fail the whole stream.
		"-sn",
		"pipe:1",
	);

	return args;
}

/**
 * Streams a remux to the response.
 *
 * Resolves when ffmpeg exits or the client disconnects. The slot is released in
 * both cases — a viewer closing the tab must free capacity immediately, or two
 * abandoned streams lock the feature out until they time out.
 */
export async function streamRemux(res: Response, opts: RemuxOptions): Promise<void> {
	if (active >= MAX_CONCURRENT) {
		res.status(503).json({
			success: false,
			message: "Two videos are already being converted. Try again when one finishes, or download the file instead.",
			code: "REMUX_BUSY",
		});
		return;
	}

	active++;
	const args = buildArgs(opts);
	const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
		stdio: ["ignore", "pipe", "pipe"],
	});

	// Fragmented MP4 has no length and is not seekable by byte range — seeking
	// is done by restarting at an offset, which is what `?t=` is for.
	res.setHeader("Content-Type", "video/mp4");
	res.setHeader("Accept-Ranges", "none");
	res.setHeader("Cache-Control", "no-store");

	let stderr = "";
	ff.stderr.on("data", (c: Buffer) => {
		stderr = (stderr + c.toString()).slice(-2000);
	});

	ff.stdout.pipe(res);

	await new Promise<void>((resolve) => {
		const done = () => {
			active = Math.max(0, active - 1);
			resolve();
		};

		// The viewer navigated away or seeked. Kill ffmpeg rather than letting it
		// transcode into a socket nobody is reading.
		res.on("close", () => {
			if (!ff.killed) ff.kill("SIGKILL");
			done();
		});

		ff.on("error", (err) => {
			logger.error({ err }, "ffmpeg failed to start");
			if (!res.headersSent) res.status(500).end();
			done();
		});

		ff.on("close", (code) => {
			// A non-zero exit after streaming began cannot be reported — the
			// response is already partly sent — so it is logged instead.
			if (code !== 0 && code !== null) {
				logger.warn({ code, stderr: stderr.slice(-500), path: opts.absPath }, "remux exited non-zero");
			}
			if (!res.writableEnded) res.end();
			done();
		});
	});
}
