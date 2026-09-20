/**
 * Turns a raw User-Agent into something you can read at a glance in the access
 * log.
 *
 * This exists because two rows with the same IP can be two different things,
 * and the address alone cannot tell you which. A real case from the log:
 *
 *   15:43:18  download  152.57.125.212  Chrome/153 (Win64)
 *   15:43:49  download  152.57.125.212  Trident/7.0; rv:11.0
 *
 * — one person clicking download, then a download manager grabbing the link off
 * the browser and restarting it. Without the client, that reads as two
 * downloads. Likewise the "visitor" from a second address is often WhatsApp
 * fetching a link preview, not a human opening the page.
 *
 * Deliberately a lookup table and not a UA-parsing library: the set of clients
 * that reach a share link is small, the cost of being vague ("Unknown client")
 * is nil, and the exact string stays one hover away regardless.
 */

export interface ClientDescription {
	/** Short, human label: "Chrome 153 · Windows". */
	label: string;
	/** A crawler or link-preview fetcher — something that is not a visitor. */
	bot: boolean;
	/** A download manager or command-line tool, not an interactive browser. */
	tool: boolean;
}

/** Matched before anything else: these strings are the whole identity. */
const BOTS: [RegExp, string][] = [
	[/WhatsApp/i, "WhatsApp preview"],
	[/TelegramBot/i, "Telegram preview"],
	[/Twitterbot/i, "X/Twitter preview"],
	[/Discordbot/i, "Discord preview"],
	[/facebookexternalhit|Facebot/i, "Facebook preview"],
	[/Slackbot|Slack-ImgProxy/i, "Slack preview"],
	[/SkypeUriPreview/i, "Skype preview"],
	[/LinkedInBot/i, "LinkedIn preview"],
	[/redditbot/i, "Reddit preview"],
	[/Googlebot/i, "Googlebot"],
	[/bingbot/i, "Bingbot"],
	[/DuckDuckBot/i, "DuckDuckBot"],
	[/Applebot/i, "Applebot"],
	[/\bbot\b|crawler|spider|scraper/i, "Bot"],
];

const TOOLS: [RegExp, string][] = [
	[/aria2/i, "aria2"],
	[/\bcurl\//i, "curl"],
	[/\bWget\b/i, "wget"],
	[/IDM|Internet Download Manager/i, "Internet Download Manager"],
	[/FDM|Free Download Manager/i, "Free Download Manager"],
	[/JDownloader/i, "JDownloader"],
	[/axel|HTTPie|python-requests|okhttp|Java\//i, "Script or tool"],
	// IDM's fixed UA. It claims IE11 on Windows 7 whatever it is really running,
	// which in 2026 is a far better signal of a download manager than of IE.
	[/Trident\/7\.0.*rv:11\.0/i, "Download manager"],
	[/libtorrent|Transmission|qBittorrent/i, "Torrent client"],
];

const PLAYERS: [RegExp, string][] = [
	[/VLC/i, "VLC"],
	[/Kodi|XBMC/i, "Kodi"],
	[/Infuse/i, "Infuse"],
	[/\bmpv\b/i, "mpv"],
	[/ExoPlayer/i, "ExoPlayer"],
	[/AppleCoreMedia/i, "Apple player"],
];

/** Order matters: every Chromium UA also says "Safari", Edge also says "Chrome". */
const BROWSERS: [RegExp, string][] = [
	[/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
	[/OPR\/(\d+)/, "Opera"],
	[/SamsungBrowser\/(\d+)/, "Samsung Internet"],
	[/Vivaldi\/(\d+)/, "Vivaldi"],
	[/Brave\/(\d+)/, "Brave"],
	[/Firefox\/(\d+)/, "Firefox"],
	[/Chrome\/(\d+)/, "Chrome"],
	[/Version\/(\d+).*Safari/, "Safari"],
];

const PLATFORMS: [RegExp, string][] = [
	[/Android/i, "Android"],
	[/iPhone/i, "iPhone"],
	[/iPad/i, "iPad"],
	[/CrOS/i, "ChromeOS"],
	// Version numbers are skipped on purpose: clients freeze and lie about them
	// (the download manager above insists it is on Windows 7), so the family is
	// the only part worth showing.
	[/Windows/i, "Windows"],
	[/Mac OS X|Macintosh/i, "macOS"],
	[/Linux/i, "Linux"],
];

const firstMatch = (ua: string, table: [RegExp, string][]) => table.find(([re]) => re.test(ua));

export function describeClient(ua: string | null | undefined): ClientDescription {
	if (!ua?.trim()) return { label: "No user agent", bot: false, tool: true };

	const bot = firstMatch(ua, BOTS);
	if (bot) return { label: bot[1], bot: true, tool: false };

	const platform = firstMatch(ua, PLATFORMS)?.[1];
	const withPlatform = (name: string) => (platform ? `${name} · ${platform}` : name);

	const tool = firstMatch(ua, TOOLS);
	if (tool) return { label: tool[1], bot: false, tool: true };

	const player = firstMatch(ua, PLAYERS);
	if (player) return { label: withPlatform(player[1]), bot: false, tool: true };

	const browser = firstMatch(ua, BROWSERS);
	if (browser) {
		const version = ua.match(browser[0])?.[1];
		return { label: withPlatform(version ? `${browser[1]} ${version}` : browser[1]), bot: false, tool: false };
	}

	// Something real reached the link and we cannot name it. Say so plainly
	// rather than guessing — the full string is on the row's tooltip.
	return { label: platform ? `Unknown client · ${platform}` : "Unknown client", bot: false, tool: true };
}
