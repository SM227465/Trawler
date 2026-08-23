"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, LoaderCircle, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsDialog } from "./SettingsDialog";
import { api, type StorageStatus } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";

/**
 * Nothing here deletes on its own. Automatic eviction is off by default, so this
 * panel SUGGESTS what could be freed and the user decides. The one delete path
 * is the explicit "Clean up now" button below, and even that honours pins and
 * active shares.
 */
export function StoragePanel() {
	const qc = useQueryClient();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const { data } = useQuery<StorageStatus>({
		queryKey: ["storage"],
		queryFn: api.storage,
		refetchInterval: 30_000,
	});

	const cleanup = useMutation({
		mutationFn: api.runEviction,
		onSuccess: () => {
			setConfirmOpen(false);
			qc.invalidateQueries({ queryKey: ["storage"] });
			qc.invalidateQueries({ queryKey: ["torrent-index"] });
		},
	});

	if (!data) return null;

	const { disk, settings, libraryBytes, pressure, atRisk } = data;
	const budgeted = settings.budgetBytes > 0;

	// Whichever limit actually governs is the one worth showing.
	const used = budgeted ? libraryBytes : (disk?.usedBytes ?? 0);
	const limit = budgeted ? settings.budgetBytes : (disk?.totalBytes ?? 0);
	const thresholdPct = budgeted ? 100 : settings.highWatermarkPct;
	const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

	return (
		<section
			className="rounded-[var(--ct-radius)] border border-border bg-surface p-4"
			aria-label="Storage"
		>
			<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
				<span className="inline-flex items-center gap-2 text-sm font-medium text-fg">
					<HardDrive className="size-4 text-fg-subtle" aria-hidden />
					{budgeted ? "Library" : "Disk"}
				</span>
				<span className="tabular text-sm text-fg-muted">
					{formatBytes(used)} of {formatBytes(limit)}
				</span>
				<span className="text-xs text-fg-subtle">
					{settings.enabled ? "auto-cleanup on" : "manual cleanup only"}
				</span>
				<span className="ml-auto flex items-center gap-3">
					{disk && budgeted && (
						<span className="tabular text-xs text-fg-subtle">{formatBytes(disk.freeBytes)} free on disk</span>
					)}
					<Button
						size="icon"
						variant="ghost"
						title="Cleanup settings"
						aria-label="Cleanup settings"
						onClick={() => setSettingsOpen(true)}
					>
						<Settings2 className="size-3.5" aria-hidden />
					</Button>
				</span>
			</div>

			<div className="relative mt-3 h-2 overflow-hidden rounded-full bg-surface-inset">
				<div
					className={cn(
						"h-full rounded-full transition-[width] duration-500",
						pressure.active ? "bg-status-paused" : "bg-accent",
					)}
					style={{ width: `${pct}%` }}
				/>
				{/* Where eviction starts, so the headroom is visible at a glance. */}
				{thresholdPct < 100 && (
					<div
						className="absolute inset-y-0 w-px bg-fg-subtle"
						style={{ left: `${thresholdPct}%` }}
						title={`Eviction starts at ${thresholdPct}%`}
					/>
				)}
			</div>

			<p className="mt-2 text-xs text-fg-subtle">
				{settings.enabled ? (
					<>
						Automatically deletes unpinned, unshared torrents idle longer than {settings.ttlHours}h
						{budgeted ? " once the library exceeds its budget" : `, or once the disk passes ${thresholdPct}%`}.
					</>
				) : (
					<>Nothing is deleted automatically. Cleanup happens only when you ask for it.</>
				)}
			</p>

			{atRisk.count > 0 && (
				<div className="mt-3 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset p-3">
					<p className="flex items-center gap-2 text-xs font-medium text-fg">
						<Sparkles className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
						{atRisk.count} torrent{atRisk.count === 1 ? "" : "s"} idle longer than {settings.ttlHours}h
						{atRisk.bytes > 0 && (
							<span className="tabular font-normal text-fg-muted">— {formatBytes(atRisk.bytes)} could be freed</span>
						)}
					</p>

					<ul className="mt-2 space-y-0.5">
						{atRisk.torrents.slice(0, 5).map((t) => (
							<li key={t.id} className="truncate text-xs text-fg-muted" title={t.name}>
								{t.name} <span className="tabular text-fg-subtle">{formatBytes(t.sizeBytes)}</span>
							</li>
						))}
					</ul>

					<div className="mt-3 flex items-center gap-3">
						<Button size="sm" variant="subtle" onClick={() => setConfirmOpen(true)} disabled={cleanup.isPending}>
							{cleanup.isPending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
							Clean up now
						</Button>
						<span className="text-[0.6875rem] text-fg-subtle">Pinned and shared torrents are never touched.</span>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={confirmOpen}
				onClose={() => setConfirmOpen(false)}
				onConfirm={() => cleanup.mutate()}
				title="Clean up idle torrents"
				description={`Delete ${atRisk.count} torrent${atRisk.count === 1 ? "" : "s"} and free ${formatBytes(atRisk.bytes)}?`}
				confirmLabel="Delete them"
				danger
				busy={cleanup.isPending}
			>
				<ul className="max-h-40 space-y-1 overflow-y-auto rounded-[var(--ct-radius-sm)] bg-surface-inset p-2">
					{atRisk.torrents.map((t) => (
						<li key={t.id} className="truncate text-xs text-fg-muted" title={t.name}>
							{t.name}
						</li>
					))}
				</ul>
				<p className="mt-2 text-xs text-fg-subtle">
					Files are removed from disk. Pinned and shared torrents are skipped.
				</p>
			</ConfirmDialog>

			<SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} />
		</section>
	);
}
