"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { UPLOADS_KEY } from "@/lib/useUploads";
import { TransferRow } from "./TransferRow";

const PAGE_SIZE = 25;

const FILTERS = [
	{ value: "", label: "All" },
	{ value: "completed", label: "Completed" },
	{ value: "failed", label: "Failed" },
	{ value: "cancelled", label: "Cancelled" },
] as const;

/**
 * Every transfer that has finished, whatever way it finished.
 *
 * Paged from the server rather than filtered from the live list: the record is
 * the point, and a history that only goes back as far as the progress poller
 * happens to fetch is not one. Failures are kept, with their error — a transfer
 * that died is the row you most want to still be there tomorrow.
 */
export function TransferHistory() {
	const qc = useQueryClient();
	const [status, setStatus] = useState<string>("");
	const [page, setPage] = useState(0);

	const { data, isLoading } = useQuery({
		queryKey: ["upload-history", status, page],
		queryFn: () => api.uploadHistory({ status: status || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
		// Without this the table empties on every page turn, which reads as data
		// loss rather than a page load.
		placeholderData: keepPreviousData,
	});

	const clear = useMutation({
		mutationFn: () => api.clearFinishedUploads(),
		onSuccess: () => {
			setPage(0);
			qc.invalidateQueries({ queryKey: ["upload-history"] });
			qc.invalidateQueries({ queryKey: UPLOADS_KEY });
		},
	});

	const total = data?.total ?? 0;
	const items = data?.items ?? [];
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<section className="rounded-[var(--ct-radius)] border border-border bg-surface">
			<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
				<History className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				<h2 className="text-sm font-medium text-fg">History</h2>

				<div
					className="ml-auto flex flex-wrap gap-1 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset p-1"
					role="tablist"
					aria-label="Filter transfers by outcome"
				>
					{FILTERS.map((f) => (
						<button
							key={f.value || "all"}
							type="button"
							role="tab"
							aria-selected={status === f.value}
							onClick={() => {
								setStatus(f.value);
								setPage(0);
							}}
							className={cn(
								"cursor-pointer rounded-[0.3rem] px-2.5 py-1 text-xs font-medium transition-colors",
								status === f.value ? "bg-surface text-fg shadow-[var(--ct-shadow)]" : "text-fg-muted hover:text-fg",
							)}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>

			{isLoading && !data ? (
				<p className="px-4 py-8 text-center text-sm text-fg-muted">Loading…</p>
			) : items.length === 0 ? (
				<p className="px-4 py-8 text-center text-sm text-fg-muted">
					{status ? "Nothing with that outcome." : "No transfers have finished yet."}
				</p>
			) : (
				<ul>
					{items.map((u) => (
						<TransferRow key={u.id} upload={u} />
					))}
				</ul>
			)}

			{total > 0 && (
				<div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5">
					<p className="tabular text-xs text-fg-muted">
						{page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
					</p>

					{/* Deleting the record is a deliberate act, so it sits at the end of
					    the history rather than next to the transfers still running. */}
					<Button
						size="sm"
						variant="ghost"
						onClick={() => clear.mutate()}
						disabled={clear.isPending}
						className="ml-auto"
					>
						Clear history
					</Button>

					<span className="flex items-center gap-1">
						<Button
							size="icon"
							variant="subtle"
							onClick={() => setPage((p) => Math.max(0, p - 1))}
							disabled={page === 0}
							aria-label="Previous page"
						>
							<ChevronLeft className="size-4" aria-hidden />
						</Button>
						<Button
							size="icon"
							variant="subtle"
							onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
							disabled={page >= pages - 1}
							aria-label="Next page"
						>
							<ChevronRight className="size-4" aria-hidden />
						</Button>
					</span>
				</div>
			)}
		</section>
	);
}
