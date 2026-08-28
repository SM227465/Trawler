import { CloudDownload, FileWarning } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AutoDownload } from "@/components/share/AutoDownload";
import { asAttachment } from "@/lib/attachment";
import { formatBytes } from "@/lib/format";
import { fetchPublicShare, type ShareDeadReason } from "@/lib/serverApi";
import { UnlockForm } from "./UnlockForm";

/**
 * The ONE public route, and the one genuinely server-rendered page.
 *
 * It gets pasted into WhatsApp, Discord and Telegram, all of which fetch it
 * server-side to build a preview card and never run JavaScript. That is the
 * entire reason this project uses Next rather than a Vite SPA (doc 03 §B7).
 */

type Params = { params: Promise<{ shareId: string }> };

const DEAD: Record<ShareDeadReason, string> = {
	revoked: "This link has been revoked by its owner.",
	expired: "This link has expired.",
	quota: "This link has reached its download limit.",
	missing: "This link does not exist.",
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
	const { shareId } = await params;
	const result = await fetchPublicShare(shareId, (await headers()).get("cookie") ?? undefined);

	// A dead or locked link must not leak a filename into a chat preview.
	const title =
		result.ok && !result.share.locked ? (result.share.label ?? result.share.name ?? "Shared file") : "Shared file";
	const description =
		result.ok && !result.share.locked && result.share.sizeBytes
			? `${formatBytes(result.share.sizeBytes)} — ready to download`
			: "A file shared with you.";

	return {
		title,
		description,
		// Never indexed. A share id is a secret; a search engine holding it is
		// the same as the link leaking.
		robots: { index: false, follow: false, nocache: true },
		openGraph: { title, description, type: "website" },
		twitter: { card: "summary", title, description },
	};
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
			<div className="w-full max-w-md">
				<div className="mb-5 flex items-center justify-center gap-2 text-fg-muted">
					<span className="grid size-7 place-items-center rounded-[var(--ct-radius-sm)] bg-accent-soft text-accent">
						<CloudDownload className="size-4" aria-hidden />
					</span>
					<span className="text-sm font-medium">Trawler</span>
				</div>

				{/* Glass is used HERE and only here: one static card, no live data.
				    The dashboard repaints at 1 Hz and cannot afford backdrop-filter
				    (doc 03 §B6). */}
				<div className="glass rounded-[var(--ct-radius)] p-6 sm:p-8">{children}</div>
			</div>
		</main>
	);
}

export default async function SharePage({ params }: Params) {
	const { shareId } = await params;
	const h = await headers();
	const result = await fetchPublicShare(shareId, h.get("cookie") ?? undefined, {
		ip: h.get("x-forwarded-for") ?? undefined,
		userAgent: h.get("user-agent") ?? undefined,
		countAsView: true,
	});

	if (!result.ok) {
		return (
			<Shell>
				<div className="text-center">
					<FileWarning className="mx-auto size-8 text-fg-subtle" aria-hidden />
					<h1 className="mt-3 text-base font-semibold text-fg">Link unavailable</h1>
					<p className="mt-1.5 text-sm text-fg-muted">{DEAD[result.reason]}</p>
				</div>
			</Shell>
		);
	}

	const share = result.share;

	if (share.locked) {
		return (
			<Shell>
				<h1 className="text-base font-semibold text-fg">Protected link</h1>
				<p className="mt-1.5 text-sm text-fg-muted">Enter the password to see what was shared with you.</p>
				<UnlockForm shareId={share.id} />
			</Shell>
		);
	}

	const expires = share.expiresAt ? new Date(share.expiresAt) : null;

	return (
		<Shell>
			<h1 className="break-words text-base font-semibold text-fg">{share.label ?? share.name}</h1>
			{share.label && share.name && share.label !== share.name && (
				<p className="mt-1 break-words text-sm text-fg-muted">{share.name}</p>
			)}

			<dl className="mt-4 space-y-1.5 text-sm">
				{share.sizeBytes !== null && (
					<div className="flex justify-between gap-4">
						<dt className="text-fg-muted">Size</dt>
						<dd className="tabular text-fg">{formatBytes(share.sizeBytes)}</dd>
					</div>
				)}
				{expires && (
					<div className="flex justify-between gap-4">
						<dt className="text-fg-muted">Available until</dt>
						<dd className="text-fg">{expires.toLocaleDateString(undefined, { dateStyle: "medium" })}</dd>
					</div>
				)}
			</dl>

			{share.allowDownload ? (
				<AutoDownload href={asAttachment(`/dl/${share.id}/${encodeURIComponent(share.name ?? "download")}`)} />
			) : (
				<p className="mt-6 text-sm text-fg-muted">Downloading is disabled for this link.</p>
			)}

			<p className="mt-4 text-center text-xs text-fg-subtle">
				Shared privately. This page is not indexed by search engines.
			</p>
		</Shell>
	);
}
