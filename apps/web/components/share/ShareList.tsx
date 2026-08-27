"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Copy, Eye, Link2Off, Lock, Share2 } from "lucide-react";
import { useState } from "react";
import { ShareAccessDialog } from "@/components/share/ShareAccessDialog";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api, type Share } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatSince } from "@/lib/format";
import { useCopy } from "@/lib/useCopy";

const STATE: Record<Share["state"], { label: string; tone: string }> = {
	active: { label: "Active", tone: "bg-status-completed-soft text-status-completed" },
	revoked: { label: "Revoked", tone: "bg-surface-inset text-fg-subtle" },
	expired: { label: "Expired", tone: "bg-surface-inset text-fg-subtle" },
	quota: { label: "Limit reached", tone: "bg-status-paused-soft text-status-paused" },
};

function Row({ share }: { share: Share }) {
	const qc = useQueryClient();
	const { copied, copy } = useCopy();
	const [access, setAccess] = useState(false);
	const [confirm, setConfirm] = useState(false);

	const revoke = useMutation({
		mutationFn: () => api.revokeShare(share.id),
		onSuccess: () => {
			setConfirm(false);
			qc.invalidateQueries({ queryKey: ["shares"] });
		},
	});

	const state = STATE[share.state];
	const live = share.state === "active";
	const usedPct = share.maxBytes ? Math.min(100, (share.bytesServed / share.maxBytes) * 100) : null;

	return (
		<li className={cn("border-b border-border p-4 last:border-b-0", !live && "opacity-70")}>
			<div className="flex flex-wrap items-start gap-x-3 gap-y-2">
				<div className="min-w-0 flex-1">
					<p className="flex items-center gap-2 text-sm font-medium text-fg">
						<span className="truncate" title={share.label ?? share.id}>
							{share.label ?? share.id}
						</span>
						{share.hasPassword && <Lock className="size-3 shrink-0 text-fg-subtle" aria-label="Password protected" />}
					</p>
					<p className="mt-0.5 truncate font-mono text-xs text-fg-subtle" title={share.url}>
						{share.url}
					</p>
				</div>

				<span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium", state.tone)}>
					{state.label}
				</span>

				<div className="flex shrink-0 gap-1">
					<Button
						size="icon"
						variant="ghost"
						onClick={() => setAccess(true)}
						title="Who used this link"
						aria-label="Who used this link"
					>
						<Eye className="size-3.5" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						onClick={() => copy(share.url)}
						title={copied ? "Copied" : "Copy link"}
						aria-label="Copy link"
					>
						{copied ? <Check className="size-3.5 text-status-completed" /> : <Copy className="size-3.5" />}
					</Button>
					{live && (
						<Button
							size="icon"
							variant="ghost"
							onClick={() => setConfirm(true)}
							title="Revoke this link"
							aria-label="Revoke"
							className="hover:text-danger"
						>
							<Ban className="size-3.5" />
						</Button>
					)}
				</div>
			</div>

			<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
				<div>
					<dt className="text-fg-subtle">Served</dt>
					<dd className="tabular text-fg-muted">
						{formatBytes(share.bytesServed)}
						{share.maxBytes ? ` / ${formatBytes(share.maxBytes)}` : ""}
					</dd>
				</div>
				<div>
					<dt className="text-fg-subtle">Downloads</dt>
					<dd className="tabular text-fg-muted">{share.requestCount}</dd>
				</div>
				<div>
					<dt className="text-fg-subtle">Expires</dt>
					<dd className="text-fg-muted">
						{share.expiresAt
							? new Date(share.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })
							: "never"}
					</dd>
				</div>
				<div>
					<dt className="text-fg-subtle">Last used</dt>
					<dd className="text-fg-muted">{share.lastAccessedAt ? formatSince(share.lastAccessedAt) : "never"}</dd>
				</div>
			</dl>

			{usedPct !== null && live && (
				<div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-inset">
					<div
						className={cn("h-full rounded-full", usedPct >= 90 ? "bg-status-paused" : "bg-accent")}
						style={{ width: `${usedPct}%` }}
					/>
				</div>
			)}

			<ShareAccessDialog open={access} onClose={() => setAccess(false)} shareId={share.id} />

			<ConfirmDialog
				open={confirm}
				onClose={() => setConfirm(false)}
				onConfirm={() => revoke.mutate()}
				title="Revoke this link"
				description={share.label ?? share.url}
				confirmLabel="Revoke"
				danger
				busy={revoke.isPending}
			>
				<p className="text-xs text-fg-muted">
					It stops working immediately for everyone who has it. The files stay on disk, and the record is kept so you
					can still see what was shared.
				</p>
			</ConfirmDialog>
		</li>
	);
}

export function ShareList() {
	const { data: shares, isLoading } = useQuery({ queryKey: ["shares"], queryFn: api.listShares });

	if (isLoading) return <p className="text-sm text-fg-muted">Loading…</p>;

	if (!shares || shares.length === 0) {
		return (
			<div className="rounded-[var(--ct-radius)] border border-border bg-surface p-10 text-center">
				<Share2 className="mx-auto size-8 text-fg-subtle" aria-hidden />
				<p className="mt-3 text-sm font-medium text-fg">No share links yet</p>
				<p className="mt-1 text-xs text-fg-muted">
					Open a torrent&apos;s files on the Transfers page and pick Share to create one.
				</p>
			</div>
		);
	}

	const active = shares.filter((s) => s.state === "active");
	const dead = shares.filter((s) => s.state !== "active");

	return (
		<div className="flex flex-col gap-5">
			<section>
				<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Active ({active.length})</h3>
				{active.length === 0 ? (
					<p className="rounded-[var(--ct-radius)] border border-border bg-surface p-6 text-center text-sm text-fg-muted">
						No active links.
					</p>
				) : (
					<ul className="overflow-hidden rounded-[var(--ct-radius)] border border-border bg-surface">
						{active.map((s) => (
							<Row key={s.id} share={s} />
						))}
					</ul>
				)}
			</section>

			{dead.length > 0 && (
				<section>
					<h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
						<Link2Off className="size-3.5" aria-hidden />
						No longer working ({dead.length})
					</h3>
					<ul className="overflow-hidden rounded-[var(--ct-radius)] border border-border bg-surface">
						{dead.map((s) => (
							<Row key={s.id} share={s} />
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
