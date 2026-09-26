"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { api, type TorrentFile } from "@/lib/api";
import { formatBytes } from "@/lib/format";

/**
 * What is selected, and the two moves that are tedious one file at a time.
 *
 * The case this exists for is a season pack where you want one episode: skip
 * everything, then set that one back to Normal. Two clicks instead of nineteen,
 * and one request to qBittorrent either way.
 *
 * Both actions touch unfinished files only. Skipping a finished file frees
 * nothing — qBittorrent keeps what it already has — so "Skip all" leaves those
 * alone rather than changing a setting that could not matter.
 */
export function FileSelection({ torrentId, files }: { torrentId: string; files: TorrentFile[] }) {
	const qc = useQueryClient();

	const bulk = useMutation({
		mutationFn: ({ ids, priority }: { ids: string[]; priority: 0 | 1 }) =>
			api.setFilePriorities(torrentId, ids, priority),
		onSuccess: (updated) => {
			const next = new Map(updated.map((f) => [f.id, f.priority]));
			qc.setQueryData<TorrentFile[]>(["torrent-files", torrentId], (prev) =>
				prev?.map((f) => {
					const priority = next.get(f.id);
					return priority === undefined ? f : { ...f, priority };
				}),
			);
		},
	});

	const unfinished = files.filter((f) => !f.isComplete);
	// Nothing to choose between once everything has finished, or with one file.
	if (unfinished.length < 2) return null;

	const skipped = unfinished.filter((f) => f.priority === 0);
	const wanted = unfinished.filter((f) => f.priority !== 0);

	// Counted the way qBittorrent counts its own "size": every file not set to
	// skip, finished or not — so this agrees with the torrent's header.
	const selected = files.filter((f) => f.priority !== 0);
	const selectedBytes = selected.reduce((n, f) => n + f.sizeBytes, 0);
	const totalBytes = files.reduce((n, f) => n + f.sizeBytes, 0);

	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
			<p className="tabular text-xs text-fg-muted">
				{selected.length === files.length
					? `All ${files.length} files · ${formatBytes(totalBytes)}`
					: `${selected.length} of ${files.length} files · ${formatBytes(selectedBytes)} of ${formatBytes(totalBytes)}`}
			</p>

			<div className="flex items-center gap-1.5">
				{bulk.isPending && <LoaderCircle className="size-3.5 animate-spin text-fg-subtle" aria-hidden />}
				<Button
					size="sm"
					variant="ghost"
					disabled={bulk.isPending || skipped.length === 0}
					title="Download every file that is not finished yet"
					onClick={() => bulk.mutate({ ids: skipped.map((f) => f.id), priority: 1 })}
				>
					Download all
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={bulk.isPending || wanted.length === 0}
					title="Skip every file that is not finished yet — then pick the ones you want"
					onClick={() => bulk.mutate({ ids: wanted.map((f) => f.id), priority: 0 })}
				>
					Skip all
				</Button>
			</div>

			{bulk.isError && (
				<p className="w-full text-[0.6875rem] text-status-errored">
					{bulk.error instanceof Error && bulk.error.message ? bulk.error.message : "That change did not go through."}
				</p>
			)}
		</div>
	);
}
