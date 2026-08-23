/**
 * What kind of file this is, and whether a browser stands a chance of playing it.
 *
 * Extension-based on purpose. Knowing the real codec needs ffprobe (Phase 8.1),
 * and a container tells you nothing definitive anyway — an .mp4 can hold HEVC
 * that Chrome refuses. So this is an OPTIMISTIC guess, and the player falls back
 * gracefully when the guess is wrong, rather than pretending to be certain.
 */

const VIDEO_PLAYABLE = /\.(mp4|m4v|webm|ogv)$/i;
const VIDEO_OTHER = /\.(mkv|avi|mov|wmv|flv|ts|m2ts|mpg|mpeg|divx|vob)$/i;
const AUDIO_PLAYABLE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
const SUBTITLE = /\.(srt|vtt|ass|ssa|sub)$/i;

export type MediaKind = "video" | "audio" | "image" | "subtitle" | "other";

export interface MediaInfo {
	kind: MediaKind;
	/** Worth offering a Play button for. */
	playable: boolean;
	/** Media a browser generally cannot play — offer VLC instead. */
	needsExternalPlayer: boolean;
}

export function classify(name: string): MediaInfo {
	if (VIDEO_PLAYABLE.test(name)) return { kind: "video", playable: true, needsExternalPlayer: false };
	if (VIDEO_OTHER.test(name)) return { kind: "video", playable: false, needsExternalPlayer: true };
	if (AUDIO_PLAYABLE.test(name)) return { kind: "audio", playable: true, needsExternalPlayer: false };
	if (IMAGE.test(name)) return { kind: "image", playable: true, needsExternalPlayer: false };
	if (SUBTITLE.test(name)) return { kind: "subtitle", playable: false, needsExternalPlayer: false };
	return { kind: "other", playable: false, needsExternalPlayer: false };
}
