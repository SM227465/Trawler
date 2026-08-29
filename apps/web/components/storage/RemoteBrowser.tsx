"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, File, Folder, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { api, type RemoteEntry } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatSince } from "@/lib/format";

function Crumbs({ path, onGo }: { path: string; onGo: (p: string) => void }) {
	const parts = path ? path.split("/") : [];
	return (
		<nav className="flex flex-wrap items-center gap-0.5 text-xs" aria-label="Folder path">
			<button
				type="button"
				onClick={() => onGo("")}
				className="cursor-pointer rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
			>
				Storage
			</button>
			{parts.map((part, i) => (
				<span key={parts.slice(0, i + 1).join("/")} className="flex items-center gap-0.5">
					<ChevronRight className="size-3 text-fg-subtle" aria-hidden />
					<button
						type="button"
						onClick={() => onGo(parts.slice(0, i + 1).join("/"))}
						className="cursor-pointer truncate rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
					>
						{part}
					</button>
				</span>
			))}
		</nav>
	);
}

function Row({ remote, entry, onOpen }: { remote: string; entry: RemoteEntry; onOpen: (p: string) => void }) {
	const qc = useQueryClient();
	const restore = useMutation({
		mutationFn: () => api.restoreFromRemote(remote, entry.path),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["uploads"] }),
	});

	const isDir = entry.type === "dir";

	return (
		<li className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
			{isDir ? (
				<Folder className="size-4 shrink-0 text-accent" aria-hidden />
			) : (
				<File className="size-4 shrink-0 text-fg-subtle" aria-hidden />
			)}

			{isDir ? (
				<button
					type="button"
					onClick={() => onOpen(entry.path)}
					className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-fg hover:underline"
					title={entry.name}
				>
					{entry.name}
				</button>
			) : (
				<span className="min-w-0 flex-1 truncate text-sm text-fg-muted" title={entry.name}>
					{entry.name}
				</span>
			)}

			<span className="tabular hidden shrink-0 text-xs text-fg-subtle sm:block">
				{isDir ? "folder" : formatBytes(entry.sizeBytes)}
			</span>
			<span className="hidden shrink-0 text-xs text-fg-subtle md:block">{formatSince(entry.modifiedAt)}</span>

			<button
				type="button"
				onClick={() => restore.mutate()}
				disabled={restore.isPending || restore.isSuccess}
				title={restore.isSuccess ? "Restoring" : "Bring this back to the disk"}
				aria-label={`Restore ${entry.name}`}
				className={cn(
					"grid size-7 shrink-0 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)]",
					"text-fg-subtle transition-colors hover:bg-surface-inset hover:text-accent",
					"disabled:pointer-events-none disabled:opacity-50",
				)}
			>
				{restore.isPending ? (
					<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
				) : (
					<Download className="size-3.5" aria-hidden />
				)}
			</button>
		</li>
	);
}

/**
 * What makes archived data a tier rather than a backup: it can be found and
 * brought back from here, instead of from the provider's own app.
 */
export function RemoteBrowser({ open, onClose, remote }: { open: boolean; onClose: () => void; remote: string }) {
	const [path, setPath] = useState("");
	const { data, isLoading, isError, error } = useQuery({
		queryKey: ["remote-browse", remote, path],
		queryFn: () => api.browseRemote(remote, path),
		enabled: open,
	});

	return (
		<Dialog open={open} onClose={onClose} title={remote} description="Files kept on this storage.">
			<div className="mt-4 flex flex-col gap-3">
				<Crumbs path={path} onGo={setPath} />

				<div className="max-h-80 overflow-y-auto rounded-[var(--ct-radius-sm)] border border-border">
					{isLoading && <p className="px-3 py-6 text-center text-sm text-fg-muted">Reading…</p>}
					{isError && (
						<p className="px-3 py-6 text-center text-sm text-status-errored">
							{error instanceof Error ? error.message : "Could not read that folder."}
						</p>
					)}
					{data && data.entries.length === 0 && (
						<p className="px-3 py-6 text-center text-sm text-fg-muted">Nothing here.</p>
					)}
					{data && data.entries.length > 0 && (
						<ul>
							{data.parent !== null && (
								<li className="border-b border-border px-3 py-2">
									<button
										type="button"
										onClick={() => setPath(data.parent ?? "")}
										className="flex cursor-pointer items-center gap-3 text-sm text-fg-muted hover:text-fg"
									>
										<Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden />
										..
									</button>
								</li>
							)}
							{data.entries.map((e) => (
								<Row key={e.path} remote={remote} entry={e} onOpen={setPath} />
							))}
						</ul>
					)}
				</div>

				<p className="text-xs text-fg-subtle">
					Restoring copies back onto this box&apos;s disk and leaves the copy on the storage alone. Downloading from a
					provider is inbound traffic, so it does not spend the outbound allowance.
				</p>
			</div>
		</Dialog>
	);
}
