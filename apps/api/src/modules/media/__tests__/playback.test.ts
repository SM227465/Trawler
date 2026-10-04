import { describe, expect, it } from "vitest";
import type { ProbeResult } from "../ffprobe";
import { decidePlayback, playbackCheck } from "../playback";

const probe = (p: Partial<ProbeResult>): ProbeResult => ({
	container: null,
	videoCodec: null,
	audioCodec: null,
	width: null,
	height: null,
	durationSeconds: null,
	bitrateBps: null,
	videoProfile: null,
	videoLevel: null,
	bitDepth: null,
	frameRate: null,
	...p,
});

describe("decidePlayback", () => {
	it("plays an ordinary web MP4 directly", () => {
		expect(decidePlayback(probe({ container: "mov,mp4,m4a,3gp,3g2,mj2", videoCodec: "h264", audioCodec: "aac" }))).toBe(
			"direct",
		);
	});

	it("remuxes an MKV whose streams are already fine", () => {
		// What the extension guess gets wrong pessimistically: .mkv looks
		// unplayable and is one rewrap away from playing.
		expect(decidePlayback(probe({ container: "matroska,webm", videoCodec: "h264", audioCodec: "aac" }))).toBe("remux");
	});

	it("remuxes an MP4 with AC3 audio rather than giving up", () => {
		expect(decidePlayback(probe({ container: "mov,mp4,m4a", videoCodec: "h264", audioCodec: "ac3" }))).toBe("remux");
	});

	it("rewraps HEVC even inside an MP4, and leaves the device to decide", () => {
		// The MP4 is usually tagged hev1, which Safari refuses; the rewrap retags
		// it. Whether the device decodes HEVC at all is playbackCheck's question.
		expect(decidePlayback(probe({ container: "mov,mp4,m4a", videoCodec: "hevc", audioCodec: "aac" }))).toBe("remux");
		expect(decidePlayback(probe({ container: "matroska,webm", videoCodec: "hevc", audioCodec: "eac3" }))).toBe("remux");
	});

	it("still refuses a codec no browser decodes", () => {
		expect(decidePlayback(probe({ container: "avi", videoCodec: "mpeg4", audioCodec: "mp3" }))).toBe("incompatible");
		expect(decidePlayback(probe({ container: "mpeg", videoCodec: "mpeg2video", audioCodec: "mp2" }))).toBe(
			"incompatible",
		);
	});

	it("plays audio-only files a browser understands", () => {
		expect(decidePlayback(probe({ container: "mp3", audioCodec: "mp3" }))).toBe("direct");
	});

	it("sends audio-only formats a browser refuses to an external player", () => {
		expect(decidePlayback(probe({ container: "ac3", audioCodec: "ac3" }))).toBe("incompatible");
	});

	it("treats a still image as displayable, not as a broken video", () => {
		// ffprobe describes a JPEG as an mjpeg video stream with no audio. Without
		// a special case the codec allowlist rejects it and every poster.jpg gets
		// offered to VLC.
		expect(decidePlayback(probe({ container: "image2", videoCodec: "mjpeg", durationSeconds: 0 }))).toBe("direct");
		expect(decidePlayback(probe({ container: "png_pipe", videoCodec: "png" }))).toBe("direct");
	});

	it("reports a file with no streams as not media", () => {
		expect(decidePlayback(probe({ container: "srt" }))).toBe("not_media");
	});
});

/**
 * The codec strings are what the browser is asked about, so a wrong digit
 * means a wrong answer: a playable file sent to VLC, or a black player.
 * Values are what ffprobe actually reports for real encodes.
 */
describe("playbackCheck", () => {
	const check = (p: Partial<ProbeResult>, playback: "direct" | "remux" = "remux") =>
		playbackCheck({ ...probe(p), playback });

	it("spells H.264 High 3.1 the way browsers expect", () => {
		expect(
			check({ container: "matroska,webm", videoCodec: "h264", videoProfile: "High", videoLevel: 31, bitDepth: 8 })
				?.contentType,
		).toBe('video/mp4; codecs="avc1.64001F"');
	});

	it("names 10-bit H.264 for what it is, since most browsers cannot decode it", () => {
		const c = check({ container: "matroska,webm", videoCodec: "h264", videoProfile: "High 10", videoLevel: 31, bitDepth: 10 });
		expect(c?.contentType).toBe('video/mp4; codecs="avc1.6E001F"');
		expect(c?.label).toBe("H.264 10-bit");
	});

	it("asks about HEVC Main and Main 10 as hvc1, which is what the rewrap delivers", () => {
		expect(check({ videoCodec: "hevc", videoProfile: "Main", videoLevel: 93, bitDepth: 8 })?.contentType).toBe(
			'video/mp4; codecs="hvc1.1.6.L93.B0"',
		);
		const c = check({ videoCodec: "hevc", videoProfile: "Main 10", videoLevel: 120, bitDepth: 10 });
		expect(c?.contentType).toBe('video/mp4; codecs="hvc1.2.4.L120.B0"');
		expect(c?.label).toBe("HEVC 10-bit");
	});

	it("asks about a direct WebM as WebM, and fills in a level VP9 did not declare", () => {
		expect(
			check({ container: "matroska,webm", videoCodec: "vp9", videoProfile: "Profile 0", bitDepth: 8, height: 360 }, "direct")
				?.contentType,
		).toBe('video/webm; codecs="vp09.00.40.08"');
	});

	it("spells AV1 with its sequence level and bit depth", () => {
		expect(check({ videoCodec: "av1", videoProfile: "Main", videoLevel: 1, bitDepth: 8 })?.contentType).toBe(
			'video/mp4; codecs="av01.0.01M.08"',
		);
	});

	it("assumes a 4K level for a 4K stream that did not declare one", () => {
		expect(check({ videoCodec: "hevc", videoProfile: "Main 10", bitDepth: 10, height: 2160 })?.contentType).toBe(
			'video/mp4; codecs="hvc1.2.4.L153.B0"',
		);
	});

	it("carries the size, rate and bitrate the device is asked to handle", () => {
		expect(
			check({ videoCodec: "h264", width: 1280, height: 720, frameRate: 23.976, bitrateBps: 4_500_000.4 }),
		).toMatchObject({ width: 1280, height: 720, framerate: 23.976, bitrate: 4_500_000 });
	});

	it("has nothing to ask for audio, images, or codecs no browser plays", () => {
		expect(check({ container: "mp3", audioCodec: "mp3" }, "direct")).toBeNull();
		expect(check({ container: "image2", videoCodec: "mjpeg" }, "direct")).toBeNull();
		expect(playbackCheck({ ...probe({ videoCodec: "mpeg4" }), playback: "incompatible" })).toBeNull();
	});
});
