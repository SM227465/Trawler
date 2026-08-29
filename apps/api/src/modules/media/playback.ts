import type { ProbeResult } from "./ffprobe";

export type Playback = "direct" | "remux" | "incompatible" | "not_media";

/**
 * Video codecs every current browser decodes. H.264 is universal; VP8/VP9 and
 * AV1 are safe in Chrome and Firefox and increasingly in Safari.
 *
 * HEVC is deliberately absent. Safari plays it, Chrome mostly does not, and
 * re-encoding it would peg a CPU this box does not have — so it is handed to
 * VLC instead. That is the one case where doing less is the right answer.
 */
const VIDEO_OK = new Set(["h264", "vp8", "vp9", "av1"]);
const AUDIO_OK = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

/**
 * Container FAMILIES, matched on ffprobe's `format_name`.
 *
 * The trap: ffprobe reports both .mkv and .webm as `matroska,webm`, because
 * they share a demuxer. So a container name alone cannot tell you whether a
 * browser will accept the file — an MKV holding H.264 and AAC is not playable,
 * a WebM holding VP9 and Opus is, and both say `matroska,webm`. The codecs are
 * what actually decide it.
 */
const isMp4 = (c: string) => /\bmp4\b|\bm4v\b|\bmov\b/.test(c);
const isMatroska = (c: string) => /\bmatroska\b|\bwebm\b/.test(c);
const isOgg = (c: string) => /\bogg\b/.test(c);

/** WebM is a strict subset of Matroska: only these codecs are legal in one. */
const WEBM_VIDEO = new Set(["vp8", "vp9", "av1"]);
const WEBM_AUDIO = new Set(["opus", "vorbis"]);

/** What an MP4 may hold and still play everywhere. */
const MP4_AUDIO = new Set(["aac", "mp3"]);

/**
 * Still images. ffprobe describes a JPEG as an `mjpeg` VIDEO stream with zero
 * duration and no audio, so without this a poster.jpg is reported as an
 * undecodable video and offered to VLC. Browsers display all of these natively.
 */
const IMAGE_CODECS = new Set(["mjpeg", "png", "webp", "gif", "bmp", "tiff", "apng"]);

/** Audio-only files, where there is no video stream to rewrap around. */
const AUDIO_ONLY_OK = new Set(["mp3", "aac", "flac", "opus", "vorbis", "pcm_s16le"]);

/**
 * What the browser should be offered for this file.
 *
 * The whole point of probing: an .mp4 holding HEVC is `incompatible` and an
 * .mkv holding H.264 + AAC is `remux`, neither of which an extension can tell
 * you. Guessing wrong in the optimistic direction gives the user a black
 * player; guessing wrong the other way sends them to VLC unnecessarily.
 */
export function decidePlayback(probe: ProbeResult): Playback {
	if (!probe.videoCodec && !probe.audioCodec) return "not_media";

	// Audio with no video: browsers are permissive, and there is nothing to
	// remux a video stream out of.
	if (!probe.videoCodec) {
		return probe.audioCodec && AUDIO_ONLY_OK.has(probe.audioCodec) ? "direct" : "incompatible";
	}

	// An image, not a video that fails to play. Checked before the codec
	// allowlist, which would otherwise reject every JPEG on the box.
	if (IMAGE_CODECS.has(probe.videoCodec) && !probe.audioCodec) return "direct";

	// A video codec the browser cannot decode cannot be fixed by repackaging —
	// only by re-encoding, which this box will not do.
	if (!VIDEO_OK.has(probe.videoCodec)) return "incompatible";

	const container = probe.container ?? "";
	const audio = probe.audioCodec;

	// An MP4 is direct when its audio is one an MP4 is allowed to carry. AC3 in
	// an MP4 is the common case that looks fine and is not.
	if (isMp4(container) && probe.videoCodec === "h264" && (!audio || MP4_AUDIO.has(audio))) {
		return "direct";
	}

	// Matroska: direct ONLY if it is genuinely a WebM by content. Anything else
	// in the same container — which is most .mkv files — needs rewrapping.
	if (isMatroska(container)) {
		const reallyWebm = WEBM_VIDEO.has(probe.videoCodec) && (!audio || WEBM_AUDIO.has(audio));
		return reallyWebm ? "direct" : "remux";
	}

	if (isOgg(container) && (!audio || AUDIO_OK.has(audio))) return "direct";

	// Video is decodable, so whatever is wrong is the container or the audio —
	// both fixed by copying the video through untouched and rewrapping. No frame
	// is ever decoded, which is the only reason this is affordable here.
	return "remux";
}
