"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export const PAGE_SIZES = [25, 50, 100] as const;

export function Pagination({
	total,
	page,
	pageSize,
	onPage,
	onPageSize,
}: {
	total: number;
	page: number;
	pageSize: number;
	onPage: (p: number) => void;
	onPageSize: (n: number) => void;
}) {
	const pages = Math.max(1, Math.ceil(total / pageSize));
	const from = total === 0 ? 0 : page * pageSize + 1;
	const to = Math.min(total, (page + 1) * pageSize);

	if (total <= PAGE_SIZES[0] && page === 0) return null;

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<p className="tabular text-xs text-fg-muted">
				Showing {from}–{to} of {total}
			</p>

			<div className="flex items-center gap-3">
				<label className="flex items-center gap-2 text-xs text-fg-muted">
					<span className="hidden sm:inline">Per page</span>
					<select
						value={pageSize}
						onChange={(e) => onPageSize(Number(e.target.value))}
						className={cn(
							"h-8 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2",
							"text-xs text-fg outline-none focus:border-accent cursor-pointer",
						)}
					>
						{PAGE_SIZES.map((n) => (
							<option key={n} value={n}>
								{n}
							</option>
						))}
					</select>
				</label>

				<div className="flex items-center gap-1">
					<Button
						size="icon"
						variant="subtle"
						aria-label="Previous page"
						disabled={page === 0}
						onClick={() => onPage(page - 1)}
					>
						<ChevronLeft className="size-4" aria-hidden />
					</Button>

					<span className="tabular min-w-16 text-center text-xs text-fg-muted">
						{page + 1} / {pages}
					</span>

					<Button
						size="icon"
						variant="subtle"
						aria-label="Next page"
						disabled={page >= pages - 1}
						onClick={() => onPage(page + 1)}
					>
						<ChevronRight className="size-4" aria-hidden />
					</Button>
				</div>
			</div>
		</div>
	);
}
