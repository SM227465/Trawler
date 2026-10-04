import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logger } from "@/common/utils/logger";

/**
 * Small JPEG previews for the file browser's grid: a frame of a video, a
 * scaled-down image, an audio file's embedded cover.
 *
 * Generated on first request and cached, never in bulk. A grid asks only for
 * the tiles on screen, and the browser keeps each one for a week (the URL
 * carries the file's mtime, so a changed file gets a new one).
 *
 * The cache lives in the container's temp dir on purpose. The only writable
 * mount is the downloads folder, which WebDAV and rclone serve as-is, and a
 * .thumbs folder there would show up in every client. A redeploy empties it;
 * the browser cache covers most of that, and the rest regenerates lazily.
 */

const CACHE_DIR = path.join(os.tmpdir(), "trawler-thumbs");
/** Bounding box. Tiles are ~150-250 px wide, so this stays sharp at 2x. */
const SIZE = 360;
const TIMEOUT_MS = 30_000;

const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|wmv|flv|ts|m2ts|mpe?g|3gp)$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|bmp|avif|tiff?)$/i;
/** Only those that commonly embed a cover; one without simply has no thumbnail. */
const AUDIO = /\.(mp3|flac|m4a|aac|ogg|opus)$/i;

/** Whether a file is worth asking for a thumbnail at all, by name. */
export const hasThumbnail = (name: string) => VIDEO.test(name) || IMAGE.test(name) || AUDIO.test(name);

/**
 * One ffmpeg at a time. The box has an eighth of a core to spare (doc:
 * steal time), and a grid of fifty videos must not fork fifty decoders.
 * Requests queue; past the queue limit they are refused and the tile keeps
 * its icon, which is a better failure than a stalled API.
 */
const MAX_QUEUED = 64;
let running = false;
const queue: Array<() => void> = [];

async function exclusively<T>(fn: () => Promise<T>): Promise<T> {
	if (running) {
		if (queue.length >= MAX_QUEUED) throw new Error("thumbnail queue full");
		await new Promise<void>((resolve) => queue.push(resolve));
	}
	running = true;
	try {
		return await fn();
	} finally {
		const next = queue.shift();
		if (next) next();
		else running = false;
	}
}

/** Two tiles asking for the same file share one ffmpeg. */
const inflight = new Map<string, Promise<string | null>>();

export type ThumbResult = { ok: true; file: string } | { ok: false; reason: "none" | "busy" };

/**
 * The cached thumbnail for a file, made if need be.
 *
 * `none` is remembered: a file ffmpeg cannot read (a cover-less MP3, a broken
 * image) would otherwise be retried on every scroll past it.
 */
export async function thumbnailFor(absPath: string, durationSeconds: number | null): Promise<ThumbResult> {
	const st = await stat(absPath);
	const key = createHash("sha1").update(`${absPath}\0${st.mtimeMs}\0${st.size}`).digest("hex");
	const file = path.join(CACHE_DIR, `${key}.jpg`);
	const none = path.join(CACHE_DIR, `${key}.none`);

	if (await exists(file)) return { ok: true, file };
	if (await exists(none)) return { ok: false, reason: "none" };

	let job = inflight.get(key);
	if (!job) {
		job = exclusively(() => generate(absPath, file, none, durationSeconds)).finally(() => inflight.delete(key));
		inflight.set(key, job);
	}

	try {
		const made = await job;
		return made ? { ok: true, file: made } : { ok: false, reason: "none" };
	} catch {
		return { ok: false, reason: "busy" };
	}
}

async function generate(absPath: string, file: string, none: string, durationSeconds: number | null) {
	await mkdir(CACHE_DIR, { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;

	const attempts: string[][] = [];
	if (VIDEO.test(absPath)) {
		// A fifth of the way in, capped at ten minutes: past the logos and the
		// black opening frames, without seeking deep into a long film.
		const at = durationSeconds ? Math.min(durationSeconds * 0.2, 600) : 10;
		attempts.push(videoArgs(absPath, tmp, at));
		// Too short for that, or the seek found nothing: the very start.
		attempts.push(videoArgs(absPath, tmp, 0));
	} else {
		attempts.push(stillArgs(absPath, tmp));
	}

	for (const args of attempts) {
		if ((await run(args)) && (await exists(tmp))) {
			await rename(tmp, file);
			return file;
		}
	}

	await rm(tmp, { force: true });
	await writeFile(none, "");
	logger.debug({ path: absPath }, "no thumbnail for this file");
	return null;
}

const SCALE = `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease`;
const OUTPUT = ["-map", "0:v:0", "-frames:v", "1", "-vf", SCALE, "-q:v", "5", "-f", "image2", "-y"];

/**
 * Keyframes only, from the keyframe at or before `at`. Without these two
 * flags ffmpeg decodes every frame from that keyframe up to the exact second,
 * which on 4K HEVC is seconds of CPU for one tile.
 */
const videoArgs = (abs: string, out: string, at: number) => [
	"-skip_frame",
	"nokey",
	"-ss",
	String(Math.floor(at)),
	"-noaccurate_seek",
	"-i",
	abs,
	...OUTPUT,
	out,
];

/** An image, or the cover picture an audio file carries as a video stream. */
const stillArgs = (abs: string, out: string) => ["-i", abs, ...OUTPUT, out];

function run(args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-threads", "1", ...args], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		// Below the poller and the API: a slow thumbnail is fine, a slow API is not.
		try {
			if (ff.pid) os.setPriority(ff.pid, 15);
		} catch {
			/* not permitted in this container; it still runs */
		}

		let stderr = "";
		ff.stderr.on("data", (c: Buffer) => {
			stderr = (stderr + c.toString()).slice(-500);
		});
		const timer = setTimeout(() => ff.kill("SIGKILL"), TIMEOUT_MS);
		ff.on("error", () => {
			clearTimeout(timer);
			resolve(false);
		});
		ff.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) logger.debug({ code, stderr }, "thumbnail ffmpeg failed");
			resolve(code === 0);
		});
	});
}

const exists = (p: string) =>
	stat(p).then(
		() => true,
		() => false,
	);
