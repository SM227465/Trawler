/**
 * Mark a /dl/ link as "save", not "play".
 *
 * The bytes are served by Caddy straight off disk, so the only way to tell a
 * browser to save an mp4 instead of playing it inline is a response header.
 * Caddy sets `Content-Disposition: attachment` when it sees `?dl=1`; without
 * it the Download button opened a tab and started playback, which is what a
 * Play button is for.
 *
 * Deliberately NOT applied to stream/aria2c links — those want inline bytes.
 */
export function asAttachment(url: string): string {
	return url + (url.includes("?") ? "&" : "?") + "dl=1";
}
