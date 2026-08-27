"use client";
import { useEffect, useState } from "react";

/**
 * Starts the download as soon as the share page opens.
 *
 * A share link is handed to someone so they can have the file — making them
 * find and press a button first is a step with no decision in it. Because the
 * response carries `Content-Disposition: attachment`, assigning location keeps
 * the page exactly where it is and only starts a download; it never navigates
 * away or previews, whatever the file type.
 *
 * Only rendered for shares that are unlocked and allow downloading — a
 * password-protected page must not fetch anything before the password is in.
 *
 * The visible link stays as a fallback. Browsers can and do refuse a navigation
 * that no one asked for, and a share whose download silently failed with no way
 * to retry is worse than one extra line of text.
 */
export function AutoDownload({ href }: { href: string }) {
	const [started, setStarted] = useState(false);

	useEffect(() => {
		// Next paints first, so the card is on screen before the download begins
		// and the transfer never looks like it came from nowhere.
		const id = setTimeout(() => {
			window.location.href = href;
			setStarted(true);
		}, 400);
		return () => clearTimeout(id);
	}, [href]);

	return (
		<p className="mt-6 text-center text-sm text-fg-muted">
			{started ? "Download started." : "Starting your download…"}{" "}
			<a href={href} className="text-accent underline underline-offset-2">
				Click here
			</a>{" "}
			if nothing happens.
		</p>
	);
}
