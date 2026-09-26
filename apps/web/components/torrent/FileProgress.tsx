"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { api, type TorrentFile } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";

/**
 * qBittorrent has four levels — skip, normal, high, maximum — and three are
 * offered. High and maximum only reorder which pieces get requested; neither
 * buys bandwidth, and the difference between them is not something anyone can
 * feel. So both read as "First", and choosing First sends maximum.
 */
const LEVELS = [
	{ value: 0, label: "Skip", title: "Do not download this file" },
	{ value: 1, label: "Normal", title: "Download alongside everything else" },
	{ value: 7, label: "First", title: "Fetch this before the other files" },
] as const;

type Level = (typeof LEVELS)[number]["value"];

const levelOf = (priority: number): Level => (priority === 0 ? 0 : priority >= 6 ? 7 : 1);

/**
 * An unfinished file: how far along it is, and whether to fetch it at all.
 *
 * Only unfinished files get the control. Skipping a finished file frees
 * nothing — qBittorrent keeps the data it already has — so offering it there
 * would be a button that does nothing you could see.
 */
export function FileProgress({ file }: { file: TorrentFile }) {
	const qc = useQueryClient();

	const set = useMutation({
		mutationFn: (priority: Level) => api.setFilePriority(file.id, priority),
		onSuccess: (updated) => {
			qc.setQueryData<TorrentFile[]>(["torrent-files", file.torrentId], (prev) =>
				prev?.map((f) => (f.id === updated.id ? { ...f, priority: updated.priority } : f)),
			);
		},
	});

	// Show the choice the moment it is made; if qBittorrent refuses it, the
	// file's own priority takes over again and the error says why.
	const current: Level = set.isPending && set.variables !== undefined ? set.variables : levelOf(file.priority);
	const skipped = current === 0;

	return (
		<div className="mt-2">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				{skipped ? (
					<span className="min-w-32 flex-1 text-xs text-fg-subtle">
						Skipped
						{file.progress > 0 && ` · ${formatPercent(file.progress)} was fetched before it was`}
					</span>
				) : (
					<div className="flex min-w-32 flex-1 items-center gap-2">
						<ProgressBar value={file.progress} status="downloading" className="flex-1" />
						<span className="tabular w-11 shrink-0 text-right text-[0.6875rem] text-fg-subtle">
							{formatPercent(file.progress)}
						</span>
					</div>
				)}

				{/* Same segmented pattern as the theme toggle: a radiogroup of
				    buttons, because <input type="radio"> cannot be styled as one
				    without a hidden input and a label per option. */}
				<div
					role="radiogroup"
					aria-label="Download priority"
					className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-surface-inset p-0.5"
				>
					{LEVELS.map((level) => {
						const active = level.value === current;
						return (
							// biome-ignore lint/a11y/useSemanticElements: deliberate radiogroup/radio pattern
							<button
								key={level.value}
								type="button"
								role="radio"
								aria-checked={active}
								title={level.title}
								disabled={set.isPending}
								onClick={() => {
									if (!active) set.mutate(level.value);
								}}
								className={cn(
									"h-6 cursor-pointer rounded-full px-2.5 text-[0.6875rem] transition-colors duration-150",
									"disabled:cursor-wait",
									active ? "bg-surface text-fg shadow-[var(--ct-shadow)]" : "text-fg-subtle hover:text-fg",
								)}
							>
								{level.label}
							</button>
						);
					})}
				</div>
			</div>

			{set.isError && (
				<p className="mt-1.5 text-[0.6875rem] text-status-errored">
					{set.error instanceof Error && set.error.message ? set.error.message : "That change did not go through."}
				</p>
			)}
		</div>
	);
}
