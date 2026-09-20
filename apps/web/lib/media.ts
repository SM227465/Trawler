/**
 * What kind of file this is, and whether the browser can show it in place.
 *
 * Extension-based on purpose. Knowing the real codec needs ffprobe (Phase 8.1),
 * and a container tells you nothing definitive anyway — an .mp4 can hold HEVC
 * that Chrome refuses. So this is an OPTIMISTIC guess, and the viewer falls back
 * gracefully when the guess is wrong, rather than pretending to be certain.
 */

const VIDEO_PLAYABLE = /\.(mp4|m4v|webm|ogv)$/i;
const VIDEO_OTHER = /\.(mkv|avi|mov|wmv|flv|ts|m2ts|mpg|mpeg|divx|vob)$/i;
const AUDIO_PLAYABLE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp|avif|bmp|svg|ico)$/i;
const PDF = /\.pdf$/i;

/**
 * Anything worth reading as plain text.
 *
 * Wide on purpose. The cost of being wrong is a pane of mojibake behind a
 * button nobody had to press, while the cost of being narrow is downloading a
 * 271-byte file to a folder, opening it in an editor and deleting it again.
 *
 * Subtitles are in here rather than in a category of their own: .srt is text,
 * and "can I read this?" is the only question this answers.
 *
 * .html and .xml are listed as SOURCE. They are rendered into a <pre> as
 * characters and never as markup — /dl/ is the app's own origin, so an .html
 * opened as a document would run its script with the session's cookies. (.svg
 * is matched as an image above and shown in an <img>, where scripts inside it
 * do not run either.)
 */
const TEXT = new RegExp(
	`\\.(${[
		// plain
		"txt|log|nfo|diz|md|markdown|rst|adoc|tex",
		// data and config
		"json|jsonc|json5|ya?ml|toml|ini|cfg|conf|properties|env|csv|tsv|sql",
		// markup, as source
		"html?|xml|css|scss|less",
		// code
		"[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cc|cs|php|lua|pl|r|scala|dart|vue|svelte",
		// shell and build
		"sh|bash|zsh|fish|ps1|bat|cmd|dockerfile|makefile|mk|gradle|cmake",
		// subtitles and playlists
		"srt|vtt|ass|ssa|sub|m3u8?|cue|sfv",
		// version control and misc dotfiles that still carry an extension
		"patch|diff|gitignore|gitattributes|editorconfig|lock",
	].join("|")})$`,
	"i",
);

/** Files with no extension that are conventionally text, matched whole. */
const TEXT_BY_NAME = /^(README|LICENCE|LICENSE|COPYING|CHANGELOG|AUTHORS|NOTICE|Makefile|Dockerfile)$/i;

export type MediaKind = "video" | "audio" | "image" | "text" | "pdf" | "other";

/** ffprobe's verdict, where one exists. */
export type Playback = "direct" | "remux" | "incompatible" | "not_media";

export interface MediaInfo {
	kind: MediaKind;
	/** The browser can show this in place — a player for media, a reader for a document. */
	viewable: boolean;
	/** Media a browser generally cannot play — offer VLC instead. */
	needsExternalPlayer: boolean;
}

/** Documents are read, media is played. The button says so. */
export const isDocument = (kind: MediaKind) => kind === "text" || kind === "pdf";

export function classify(name: string): MediaInfo {
	if (VIDEO_PLAYABLE.test(name)) return { kind: "video", viewable: true, needsExternalPlayer: false };
	if (VIDEO_OTHER.test(name)) return { kind: "video", viewable: false, needsExternalPlayer: true };
	if (AUDIO_PLAYABLE.test(name)) return { kind: "audio", viewable: true, needsExternalPlayer: false };
	if (IMAGE.test(name)) return { kind: "image", viewable: true, needsExternalPlayer: false };
	if (PDF.test(name)) return { kind: "pdf", viewable: true, needsExternalPlayer: false };
	if (TEXT.test(name) || TEXT_BY_NAME.test(name)) return { kind: "text", viewable: true, needsExternalPlayer: false };
	return { kind: "other", viewable: false, needsExternalPlayer: false };
}

/**
 * The extension's guess, corrected by ffprobe wherever ffprobe has an opinion.
 * An .mkv the guess calls unplayable may be one rewrap away, and an .mp4 it
 * calls playable may be HEVC.
 *
 * Documents are ours alone: ffprobe calls a .txt `not_media`, which is perfectly
 * true and says nothing at all about whether it can be read on screen.
 */
export function resolve(name: string, playback?: Playback | null): MediaInfo {
	const guess = classify(name);
	if (!playback || isDocument(guess.kind)) return guess;

	return {
		...guess,
		viewable: playback === "direct" || playback === "remux",
		needsExternalPlayer: playback === "incompatible",
	};
}
