"use client";
import { ArrowUp, CloudUpload, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TransferBar } from "@/components/ui/TransferBar";
import type { Upload } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatEta } from "@/lib/format";
import { isLive, useUploads } from "@/lib/useUploads";

/** A failure is worth a place in the header for a while, then it is history. */
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

const leaf = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/**
 * Transfers, visible from wherever you are.
 *
 * Uploading used to be something you started on one page and could only watch
 * on another, so the honest answer to "is it still going?" was to go and look.
 * This sits in the header while anything is moving and disappears when nothing
 * is — a status light, not a permanent control. The Storage page remains the
 * place to cancel, retry and read history.
 */
export function TransfersIndicator() {
	const { data } = useUploads();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const all = data ?? [];
	const live = all.filter(isLive);
	// A transfer that died an hour into a copy produces no toast — nobody was
	// looking when it happened. This is the only place that would have said so.
	const recentlyFailed = all.filter(
		(u) => u.status === "failed" && u.finishedAt && Date.now() - Date.parse(u.finishedAt) < FAILURE_WINDOW_MS,
	);

	if (live.length === 0 && recentlyFailed.length === 0) return null;

	const failing = live.length === 0;

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-label={
					live.length > 0 ? `${live.length} transfer(s) in progress` : `${recentlyFailed.length} transfer(s) failed`
				}
				title={live.length > 0 ? "Transfers in progress" : "A transfer failed"}
				className={cn(
					"relative grid size-8 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)]",
					"transition-colors hover:bg-surface-2",
					failing ? "text-status-errored" : "text-fg-muted hover:text-fg",
				)}
			>
				{failing ? <TriangleAlert className="size-4" aria-hidden /> : <CloudUpload className="size-4" aria-hidden />}
				<span
					className={cn(
						"absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full px-1",
						"text-[0.625rem] font-medium leading-4 text-bg",
						failing ? "bg-status-errored" : "bg-accent",
					)}
				>
					{live.length || recentlyFailed.length}
				</span>
			</button>

			{open && (
				<div
					className={cn(
						"absolute right-0 top-10 z-30 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden",
						"rounded-[var(--ct-radius)] border border-border bg-surface shadow-[var(--ct-shadow-lg)]",
					)}
				>
					<ul className="max-h-80 overflow-auto">
						{[...live, ...recentlyFailed].map((u) => (
							<Row key={u.id} upload={u} />
						))}
					</ul>
					<Link
						href="/cloud"
						onClick={() => setOpen(false)}
						className="block border-t border-border px-3 py-2 text-center text-xs text-accent hover:underline"
					>
						Open Cloud
					</Link>
				</div>
			)}
		</div>
	);
}

function Row({ upload }: { upload: Upload }) {
	const failed = upload.status === "failed";

	return (
		<li className="border-b border-border px-3 py-2.5 last:border-b-0">
			<div className="flex items-center gap-2">
				{failed ? (
					<TriangleAlert className="size-3.5 shrink-0 text-status-errored" aria-hidden />
				) : upload.status === "running" ? (
					<LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent" aria-hidden />
				) : (
					<ArrowUp className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
				)}
				<span className="min-w-0 flex-1 truncate text-xs text-fg" title={upload.srcPath}>
					{leaf(upload.srcPath)}
				</span>
				<span className="tabular shrink-0 text-[0.6875rem] text-fg-subtle">
					{failed ? "Failed" : upload.status === "queued" ? "Queued" : formatBytes(upload.bytesDone)}
				</span>
			</div>

			{upload.status === "running" && (
				<TransferBar
					value={upload.bytesTotal > 0 ? Math.min(1, upload.bytesDone / upload.bytesTotal) : null}
					className="mt-1.5"
				/>
			)}

			{upload.status === "running" && (
				<p className="tabular mt-1 pl-5.5 text-[0.6875rem] text-fg-subtle">
					{formatBytes(upload.speedBps ?? 0)}/s
					{upload.etaSeconds ? ` · ${formatEta(upload.etaSeconds)} left` : ""}
					{` · ${upload.remoteName}`}
				</p>
			)}
			{failed && upload.error && (
				<p className="mt-0.5 pl-5.5 text-[0.6875rem] text-status-errored" title={upload.error}>
					{upload.error}
				</p>
			)}
		</li>
	);
}
