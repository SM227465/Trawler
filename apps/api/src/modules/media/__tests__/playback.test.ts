import { describe, expect, it } from "vitest";
import type { ProbeResult } from "../ffprobe";
import { decidePlayback } from "../playback";

const probe = (p: Partial<ProbeResult>): ProbeResult => ({
	container: null,
	videoCodec: null,
	audioCodec: null,
	width: null,
	height: null,
	durationSeconds: null,
	bitrateBps: null,
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

	it("refuses HEVC even inside an MP4", () => {
		// What the extension guess gets wrong optimistically: .mp4 looks playable
		// and yields a black player in Chrome.
		expect(decidePlayback(probe({ container: "mov,mp4,m4a", videoCodec: "hevc", audioCodec: "aac" }))).toBe(
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
