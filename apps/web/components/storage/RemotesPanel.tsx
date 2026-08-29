"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cloud, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AddRemoteDialog } from "@/components/storage/AddRemoteDialog";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api, type Remote } from "@/lib/api";
import { cn } from "@/lib/cn";

const KIND_LABEL: Record<string, string> = {
	r2: "Cloudflare R2",
	b2: "Backblaze B2",
	wasabi: "Wasabi",
	aws: "Amazon S3",
	"s3-other": "S3-compatible",
};

function Row({ remote }: { remote: Remote }) {
	const qc = useQueryClient();
	const [confirming, setConfirming] = useState(false);

	const test = useMutation({ mutationFn: () => api.testRemote(remote.name) });
	const remove = useMutation({
		mutationFn: () => api.deleteRemote(remote.name),
		onSuccess: () => {
			setConfirming(false);
			qc.invalidateQueries({ queryKey: ["remotes"] });
		},
	});

	const where = [remote.bucket, remote.prefix].filter(Boolean).join("/");

	return (
		<li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-b-0">
			<Cloud className="size-4 shrink-0 text-fg-subtle" aria-hidden />

			<span className="min-w-0">
				<span className="block truncate text-sm font-medium text-fg">{remote.name}</span>
				<span className="block truncate text-xs text-fg-subtle">
					{KIND_LABEL[remote.kind ?? ""] ?? remote.type}
					{where && ` · ${where}`}
				</span>
			</span>

			<span className="ml-auto flex shrink-0 items-center gap-1.5">
				{test.isSuccess && !test.isPending && (
					<span className="inline-flex items-center gap-1 text-xs text-status-completed">
						<Check className="size-3.5" aria-hidden />
						Reachable
					</span>
				)}
				{test.isError && (
					<span
						className="max-w-[14rem] truncate text-xs text-status-errored"
						title={test.error instanceof Error ? test.error.message : ""}
					>
						{test.error instanceof Error ? test.error.message : "Unreachable"}
					</span>
				)}

				<Button size="sm" variant="ghost" onClick={() => test.mutate()} disabled={test.isPending}>
					{test.isPending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
					Test
				</Button>

				<Button
					size="icon"
					variant="ghost"
					onClick={() => setConfirming(true)}
					title="Remove this storage"
					aria-label={`Remove ${remote.name}`}
					className="hover:text-danger"
				>
					<Trash2 className="size-3.5" />
				</Button>
			</span>

			<ConfirmDialog
				open={confirming}
				onClose={() => setConfirming(false)}
				onConfirm={() => remove.mutate()}
				busy={remove.isPending}
				danger
				confirmLabel="Remove"
				title={`Remove ${remote.name}?`}
			>
				<p className="text-sm text-fg-muted">
					The credentials are deleted from this server and Trawler stops using it.{" "}
					<strong className="text-fg">Nothing is deleted at the provider</strong> — anything already uploaded stays
					exactly where it is.
				</p>
			</ConfirmDialog>
		</li>
	);
}

export function RemotesPanel() {
	const [adding, setAdding] = useState(false);
	const { data, isLoading } = useQuery({ queryKey: ["remotes"], queryFn: api.remotes });

	// Nothing to offer if the sidecar is not running — an Add button that always
	// fails is worse than no section at all.
	if (!isLoading && data && !data.available) return null;

	return (
		<section className="rounded-[var(--ct-radius)] border border-border bg-surface">
			<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
				<Cloud className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				<h2 className="text-sm font-medium text-fg">External storage</h2>
				<span className="ml-auto">
					<Button size="sm" variant="subtle" onClick={() => setAdding(true)}>
						<Plus className="size-3.5" aria-hidden />
						Add storage
					</Button>
				</span>
			</div>

			{isLoading && <p className="px-4 py-6 text-center text-sm text-fg-muted">Checking…</p>}

			{data && data.remotes.length === 0 && (
				<p className="px-4 py-6 text-sm text-fg-muted">
					No storage connected. Add an S3-compatible bucket and you can copy finished downloads off this box — useful
					when 150 GB stops being enough.
				</p>
			)}

			{data && data.remotes.length > 0 && (
				<ul>
					{data.remotes.map((r) => (
						<Row key={r.name} remote={r} />
					))}
				</ul>
			)}

			<p className={cn("border-t border-border px-4 py-2.5 text-xs text-fg-subtle")}>
				Uploading spends the same outbound allowance as sharing does — a gigabyte sent to a bucket counts exactly like a
				gigabyte sent to a share link.
			</p>

			<AddRemoteDialog open={adding} onClose={() => setAdding(false)} />
		</section>
	);
}
