/**
 * Handing a stream to a real player app, for what the browser cannot decode.
 *
 * VLC, mpv, MX Player and Infuse play every codec there is, and /dl/ links
 * authenticate by token and serve Range requests — so a player can stream and
 * seek the ORIGINAL file, all audio tracks and subtitles included, with no
 * work on the server at all. What differs per platform is only how to get
 * the link into the app.
 */

export type Platform = "android" | "ios" | "desktop";

export function detectPlatform(): Platform {
	if (typeof navigator === "undefined") return "desktop";
	const ua = navigator.userAgent;
	if (/Android/i.test(ua)) return "android";
	// iPadOS asks for desktop sites and says "Macintosh"; touch gives it away.
	if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
	return "desktop";
}

const VLC_PLAY_STORE = "https://play.google.com/store/apps/details?id=org.videolan.vlc";

/**
 * An Android intent for "view this as video". Chrome shows the chooser — VLC,
 * MX Player, whatever is installed — and with none installed, falls back to
 * VLC's Play Store page instead of doing nothing.
 */
export function androidIntent(url: string, title: string): string {
	const u = new URL(url);
	const extras = [
		`scheme=${u.protocol.replace(/:$/, "")}`,
		"type=video/*",
		`S.title=${encodeURIComponent(title)}`,
		`S.browser_fallback_url=${encodeURIComponent(VLC_PLAY_STORE)}`,
	];
	return `intent://${u.host}${u.pathname}${u.search}#Intent;${extras.join(";")};end`;
}

/** iOS apps take a stream through their x-callback-url schemes. */
export const vlcIos = (url: string) => `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}`;
export const infuse = (url: string) => `infuse://x-callback-url/play?url=${encodeURIComponent(url)}`;

/**
 * Desktop has no reliable link scheme for "open in my player", but every
 * player opens an .m3u. Saved and opened, it plays in the default one.
 */
export function downloadPlaylist(url: string, title: string) {
	const body = `#EXTM3U\n#EXTINF:-1,${title.replace(/[\r\n]/g, " ")}\n${url}\n`;
	const href = URL.createObjectURL(new Blob([body], { type: "audio/x-mpegurl" }));
	const a = document.createElement("a");
	a.href = href;
	a.download = `${title.replace(/\.[^.]+$/, "")}.m3u`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
