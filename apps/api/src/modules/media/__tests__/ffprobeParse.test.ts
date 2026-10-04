import { describe, expect, it } from "vitest";
import { parseProbe } from "../ffprobe";

/**
 * Trimmed from real ffprobe output for test encodes (libx265 10-bit in MKV,
 * libvpx-vp9 in WebM). The quirks below are ffprobe's, not invented: VP9
 * reports level -99 when the stream does not say, and bit depth lives only in
 * the pixel format name.
 */
const output = (video: object, format: object = {}) =>
	JSON.stringify({
		streams: [{ codec_type: "video", ...video }, { codec_type: "audio", codec_name: "eac3" }],
		format: { format_name: "matroska,webm", duration: "4.000000", bit_rate: "1534812", ...format },
	});

describe("parseProbe", () => {
	it("reads profile, level, bit depth and frame rate from a 10-bit HEVC encode", () => {
		const p = parseProbe(
			output({
				codec_name: "hevc",
				profile: "Main 10",
				level: 120,
				width: 1920,
				height: 1080,
				pix_fmt: "yuv420p10le",
				avg_frame_rate: "24/1",
				r_frame_rate: "24/1",
			}),
		);
		expect(p).toMatchObject({
			container: "matroska,webm",
			videoCodec: "hevc",
			audioCodec: "eac3",
			videoProfile: "Main 10",
			videoLevel: 120,
			bitDepth: 10,
			frameRate: 24,
			durationSeconds: 4,
		});
	});

	it("treats VP9's -99 as no level, and a plain pixel format as 8-bit", () => {
		const p = parseProbe(output({ codec_name: "vp9", profile: "Profile 0", level: -99, pix_fmt: "yuv420p" }));
		expect(p.videoLevel).toBeNull();
		expect(p.bitDepth).toBe(8);
	});

	it("keeps NTSC rates fractional and ignores the 0/0 ffprobe writes when it does not know", () => {
		expect(parseProbe(output({ codec_name: "h264", avg_frame_rate: "24000/1001" })).frameRate).toBeCloseTo(23.976, 3);
		expect(parseProbe(output({ codec_name: "h264", avg_frame_rate: "0/0", r_frame_rate: "25/1" })).frameRate).toBe(25);
	});
});
