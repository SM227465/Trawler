import type { ProbeResult } from "./ffprobe";

export type Playback = "direct" | "remux" | "incompatible" | "not_media";

/**
 * Video codecs a browser MAY decode. H.264 is near-universal; VP8/VP9, AV1 and
 * HEVC depend on the device — HEVC plays wherever there is a hardware decoder
 * (every Apple device, most Windows and Android ones under Chrome or Edge) and
 * nowhere else.
 *
 * Only the browser can say which, so these are rewrapped where needed and
 * `playbackCheck` hands the browser the exact codec to ask about. Re-encoding
 * is never the answer: this box has an eighth of a core to spare.
 */
const VIDEO_OK = new Set(["h264", "vp8", "vp9", "av1", "hevc"]);
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
	// is ever decoded, which is the only reason this is affordable here. HEVC
	// always lands here: even inside an MP4 it is usually tagged `hev1`, which
	// Safari refuses, and the rewrap retags it `hvc1`.
	return "remux";
}

/**
 * What to ask the browser before handing it a stream: "can you decode THIS?".
 *
 * Passed to `navigator.mediaCapabilities.decodingInfo`. Without it the only
 * way to find out is to play and fail — a black player, or a remux slot spent
 * on a stream the device was never going to decode.
 */
export interface PlaybackCheck {
	/** MIME type with its RFC 6381 codec, as the stream will reach the browser. */
	contentType: string;
	/** For people: "HEVC 10-bit". */
	label: string;
	width: number;
	height: number;
	bitrate: number;
	framerate: number;
}

type CheckInput = Pick<
	ProbeResult,
	"container" | "videoCodec" | "width" | "height" | "bitrateBps" | "videoProfile" | "videoLevel" | "bitDepth" | "frameRate"
> & { playback: Playback };

const LABELS: Record<string, string> = { h264: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8" };

/** profile_idc + constraint flags, the first four hex digits of an avc1 string. */
const AVC_PROFILES: Record<string, string> = {
	"Constrained Baseline": "42E0",
	Baseline: "4200",
	Main: "4D40",
	Extended: "5800",
	High: "6400",
	"High 10": "6E00",
	"High 10 Intra": "6E10",
	"High 4:2:2": "7A00",
	"High 4:2:2 Intra": "7A10",
	"High 4:4:4 Predictive": "F400",
	"High 4:4:4 Intra": "F410",
};

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");

/** The RFC 6381 codec string, from what ffprobe recorded. Null for codecs no browser plays. */
export function codecString(p: CheckInput): string | null {
	const depth = p.bitDepth ?? 8;
	// A level the stream did not declare: a typical one for its frame size, so
	// an unknown level neither fails a phone on 1080p nor waves 4K through.
	const level = (hd: number, uhd: number) => p.videoLevel ?? ((p.height ?? 0) > 1088 ? uhd : hd);

	switch (p.videoCodec) {
		case "h264":
			return `avc1.${AVC_PROFILES[p.videoProfile ?? ""] ?? (depth > 8 ? "6E00" : "6400")}${hex2(level(40, 51))}`;
		case "hevc":
			// Main is profile 1 (compatibility flags 0x6), Main 10 is 2 (0x4).
			return `hvc1.${depth > 8 || p.videoProfile === "Main 10" ? "2.4" : "1.6"}.L${level(120, 153)}.B0`;
		case "av1": {
			const profile = p.videoProfile === "High" ? 1 : p.videoProfile === "Professional" ? 2 : 0;
			return `av01.${profile}.${pad2(level(8, 12))}M.${pad2(depth)}`;
		}
		case "vp9": {
			const profile = Number(p.videoProfile?.match(/\d/)?.[0] ?? (depth > 8 ? 2 : 0));
			return `vp09.${pad2(profile)}.${pad2(level(40, 51))}.${pad2(depth)}`;
		}
		case "vp8":
			return "vp8";
		default:
			return null;
	}
}

/** Null when there is nothing to ask: not a video, or a codec no browser plays. */
export function playbackCheck(p: CheckInput): PlaybackCheck | null {
	if (p.playback !== "direct" && p.playback !== "remux") return null;
	const codec = codecString(p);
	if (!codec || !p.videoCodec) return null;

	// A remux always comes out as MP4; a direct file reaches the browser as itself.
	const container = p.container ?? "";
	const mime =
		p.playback === "direct" && isMatroska(container)
			? "video/webm"
			: p.playback === "direct" && isOgg(container)
				? "video/ogg"
				: "video/mp4";
	const depth = p.bitDepth ?? 8;

	return {
		contentType: `${mime}; codecs="${codec}"`,
		label: `${LABELS[p.videoCodec] ?? p.videoCodec}${depth > 8 ? ` ${depth}-bit` : ""}`,
		width: p.width ?? 1920,
		height: p.height ?? 1080,
		bitrate: Math.round(p.bitrateBps ?? 8_000_000),
		framerate: p.frameRate ?? 30,
	};
}
