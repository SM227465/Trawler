"use client";
import { Check, Copy, Download, ExternalLink, MonitorPlay } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { androidIntent, detectPlatform, downloadPlaylist, infuse, type Platform, vlcIos } from "@/lib/externalPlayer";
import { useCopy } from "@/lib/useCopy";

const HINTS: Record<Platform, string> = {
	android:
		"VLC or MX Player plays it, seeking and all. With neither installed, the button opens VLC on the Play Store.",
	ios: "VLC (free on the App Store) or Infuse plays it, seeking and all.",
	desktop:
		"Opens a playlist in your default player — VLC, mpv, IINA and PotPlayer play everything. Or paste the stream URL into VLC: Media → Open Network Stream.",
};

/**
 * What the browser cannot play, handed to an app that can.
 *
 * The app gets the ORIGINAL file, not a remux: it decodes everything, so
 * there is nothing to convert, and every audio track and subtitle survives.
 */
export function ExternalPlayers({
	url,
	name,
	reason,
	downloadHref,
	onTryAnyway,
}: {
	/** Absolute stream URL of the original file. */
	url: string;
	name: string;
	/** Why it is not playing here, in one sentence. */
	reason: string;
	/** Omitted where the page has a Download button of its own. */
	downloadHref?: string;
	/** Offered when the device said no up front. A device can be wrong about itself. */
	onTryAnyway?: () => void;
}) {
	const [platform] = useState(detectPlatform);
	const { copied, copy } = useCopy();
	// Custom schemes and intents only open from a user gesture, which a click is.
	const open = (href: string) => {
		window.location.href = href;
	};

	return (
		<div className="rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset p-4 text-center">
			<MonitorPlay className="mx-auto size-7 text-fg-subtle" aria-hidden />
			<p className="mt-2 text-sm font-medium text-fg">{reason}</p>
			<p className="mt-1 text-xs text-fg-muted">{HINTS[platform]}</p>

			<div className="mt-3 flex flex-wrap justify-center gap-2">
				{platform === "android" && (
					<Button size="sm" variant="primary" onClick={() => open(androidIntent(url, name))}>
						<ExternalLink className="size-3.5" aria-hidden />
						Open in a video app
					</Button>
				)}
				{platform === "ios" && (
					<>
						<Button size="sm" variant="primary" onClick={() => open(vlcIos(url))}>
							<ExternalLink className="size-3.5" aria-hidden />
							Open in VLC
						</Button>
						<Button size="sm" variant="subtle" onClick={() => open(infuse(url))}>
							<ExternalLink className="size-3.5" aria-hidden />
							Open in Infuse
						</Button>
					</>
				)}
				{platform === "desktop" && (
					<Button size="sm" variant="primary" onClick={() => downloadPlaylist(url, name)}>
						<ExternalLink className="size-3.5" aria-hidden />
						Open in your player
					</Button>
				)}
				<Button size="sm" variant="subtle" onClick={() => copy(url)}>
					{copied ? <Check className="size-3.5 text-status-completed" /> : <Copy className="size-3.5" />}
					{copied ? "Copied" : "Copy stream URL"}
				</Button>
				{downloadHref && (
					<Button size="sm" variant="subtle" onClick={() => window.open(downloadHref, "_blank", "noopener")}>
						<Download className="size-3.5" aria-hidden />
						Download
					</Button>
				)}
			</div>

			{onTryAnyway && (
				<button
					type="button"
					onClick={onTryAnyway}
					className="mt-3 cursor-pointer text-xs text-fg-subtle underline underline-offset-2 hover:text-fg"
				>
					Try in the browser anyway
				</button>
			)}
		</div>
	);
}
