"use client";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCopy } from "@/lib/useCopy";

function CopyRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
	const { copied, copy } = useCopy();
	const [shown, setShown] = useState(!secret);

	return (
		<div className="flex flex-col gap-1.5 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
			<span className="text-sm text-fg-muted sm:w-28 sm:shrink-0">{label}</span>
			<code
				className={cn(
					"min-w-0 flex-1 truncate rounded-[var(--ct-radius-sm)] bg-surface-inset px-2.5 py-1.5",
					"font-mono text-xs text-fg",
				)}
			>
				{shown ? value : "•".repeat(Math.min(24, value.length))}
			</code>
			<span className="flex shrink-0 gap-1">
				{secret && (
					<Button
						size="icon"
						variant="ghost"
						onClick={() => setShown((v) => !v)}
						aria-label={shown ? "Hide" : "Reveal"}
						title={shown ? "Hide" : "Reveal"}
					>
						{shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
					</Button>
				)}
				<Button
					size="icon"
					variant="ghost"
					onClick={() => copy(value)}
					aria-label={`Copy ${label}`}
					title={copied ? "Copied" : `Copy ${label}`}
				>
					{copied ? <Check className="size-3.5 text-status-completed" /> : <Copy className="size-3.5" />}
				</Button>
			</span>
		</div>
	);
}

const MOUNTS = [
	{ os: "Windows", how: "File Explorer → right-click This PC → Add a network location, then paste the URL." },
	{ os: "macOS", how: "Finder → Go → Connect to Server (⌘K), paste the URL." },
	{ os: "Linux (GNOME)", how: "Files → Other Locations → Connect to Server, prefix the URL with dav:// or davs://." },
	{ os: "rclone / CLI", how: "rclone mount, or any WebDAV client — VLC and Infuse can stream directly from it." },
];

export function WebdavAccess() {
	const { data } = useQuery({ queryKey: ["webdav"], queryFn: api.webdav });
	if (!data) return <p className="text-sm text-fg-muted">Loading…</p>;

	if (!data.enabled) {
		return (
			<p className="rounded-[var(--ct-radius)] border border-border bg-surface p-4 text-sm text-fg-muted">
				WebDAV is not configured — set <code className="font-mono text-xs">WEBDAV_PASSWORD</code> and restart.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-2.5 rounded-[var(--ct-radius)] border border-border bg-surface-inset p-3">
				<Lock className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
				<p className="text-xs text-fg-muted">
					<strong className="text-fg">Read-only.</strong> qBittorrent owns these files — a writable mount would let a
					client delete them behind its back, and qBittorrent would re-check or re-download everything. Delete torrents
					from the Transfers page instead.
				</p>
			</div>

			<section className="rounded-[var(--ct-radius)] border border-border bg-surface px-4">
				<CopyRow label="URL" value={data.url} />
				<CopyRow label="Username" value={data.username} />
				<CopyRow label="Password" value={data.password} secret />
			</section>

			<section className="rounded-[var(--ct-radius)] border border-border bg-surface p-4">
				<h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">How to mount</h3>
				<dl className="mt-3 space-y-2.5">
					{MOUNTS.map((m) => (
						<div key={m.os} className="sm:flex sm:gap-4">
							<dt className="text-sm text-fg sm:w-32 sm:shrink-0">{m.os}</dt>
							<dd className="text-xs text-fg-muted">{m.how}</dd>
						</div>
					))}
				</dl>
			</section>
		</div>
	);
}
