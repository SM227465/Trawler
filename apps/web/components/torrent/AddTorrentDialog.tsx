"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, FileUp, LoaderCircle, Copy as Dup } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { api, type BatchResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { TORRENT_IDS_KEY } from "@/lib/useTorrentStream";

const MAGNET_LIMIT = 50;
const FILE_LIMIT = 20;

/** Split on newlines AND whitespace — people paste both ways. */
function parseMagnets(text: string): string[] {
	return text
		.split(/[\n\r]+/)
		.flatMap((line) => line.split(/\s+/))
		.map((s) => s.trim())
		.filter(Boolean);
}

function ResultList({ result }: { result: BatchResult }) {
	const icon = {
		added: <Check className="size-3.5 shrink-0 text-status-completed" aria-hidden />,
		duplicate: <Dup className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />,
		failed: <CircleAlert className="size-3.5 shrink-0 text-status-errored" aria-hidden />,
	};

	return (
		<div className="mt-4">
			<p className="text-xs text-fg-muted">
				{result.added} added
				{result.duplicates > 0 && ` · ${result.duplicates} already present`}
				{result.failed > 0 && ` · ${result.failed} failed`}
			</p>
			<ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-[var(--ct-radius-sm)] bg-surface-inset p-2">
				{result.results.map((r) => (
					<li key={r.input} className="flex items-start gap-2 text-xs">
						{icon[r.status]}
						<span className="min-w-0 flex-1">
							<span className="block truncate text-fg" title={r.name ?? r.input}>
								{r.name ?? r.input}
							</span>
							{r.error && <span className="block text-status-errored">{r.error}</span>}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function AddTorrentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const qc = useQueryClient();
	const fileRef = useRef<HTMLInputElement>(null);
	const [text, setText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [dragging, setDragging] = useState(false);
	const [result, setResult] = useState<BatchResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const magnets = parseMagnets(text);

	const reset = () => {
		setText("");
		setFiles([]);
		setResult(null);
		setError(null);
	};

	const refresh = () => {
		// SSE delivers the new rows, but nudge the id list so they appear at once.
		qc.invalidateQueries({ queryKey: TORRENT_IDS_KEY });
	};

	const submit = useMutation({
		mutationFn: async (): Promise<BatchResult> => {
			// One dialog, two transports — merge the outcomes so the user sees a
			// single result list regardless of how they supplied the torrents.
			const parts: BatchResult[] = [];
			if (magnets.length > 0) parts.push(await api.addMagnets(magnets.slice(0, MAGNET_LIMIT)));
			if (files.length > 0) parts.push(await api.addTorrentFiles(files.slice(0, FILE_LIMIT)));
			return parts.reduce<BatchResult>(
				(acc, p) => ({
					results: [...acc.results, ...p.results],
					added: acc.added + p.added,
					duplicates: acc.duplicates + p.duplicates,
					failed: acc.failed + p.failed,
				}),
				{ results: [], added: 0, duplicates: 0, failed: 0 },
			);
		},
		onSuccess: (r) => {
			setResult(r);
			setError(null);
			setText("");
			setFiles([]);
			refresh();
		},
		onError: (e) => setError(e instanceof Error ? e.message : "Could not add torrents"),
	});

	const takeFiles = (list: FileList | null) => {
		const picked = Array.from(list ?? []).filter((f) => /\.torrent$/i.test(f.name));
		if (picked.length === 0) {
			setError("No .torrent files in that selection");
			return;
		}
		setError(null);
		setFiles((prev) => [...prev, ...picked].slice(0, FILE_LIMIT));
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		setDragging(false);
		takeFiles(e.dataTransfer.files);
	};

	const nothingToAdd = magnets.length === 0 && files.length === 0;

	return (
		<Dialog
			open={open}
			onClose={() => {
				reset();
				onClose();
			}}
			title="Add torrents"
			description="Paste magnet links — one per line — or attach .torrent files. Both at once is fine."
		>
			<div
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
				className={cn(
					"mt-4 rounded-[var(--ct-radius-sm)] transition-colors",
					dragging && "outline-2 outline-dashed outline-offset-2 outline-accent",
				)}
			>
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					rows={5}
					spellCheck={false}
					placeholder={"magnet:?xt=urn:btih:…\nmagnet:?xt=urn:btih:…"}
					aria-label="Magnet links, one per line"
					className={cn(
						"w-full resize-y rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset p-3",
						"font-mono text-xs text-fg placeholder:text-fg-subtle",
						"outline-none transition-colors focus:border-accent",
					)}
				/>

				<div className="mt-2 flex flex-wrap items-center gap-2">
					<input
						ref={fileRef}
						type="file"
						multiple
						accept=".torrent,application/x-bittorrent"
						className="sr-only"
						onChange={(e) => {
							takeFiles(e.target.files);
							e.target.value = "";
						}}
					/>
					<Button size="sm" variant="subtle" onClick={() => fileRef.current?.click()}>
						<FileUp className="size-3.5" aria-hidden />
						Attach .torrent files
					</Button>

					<span className="text-xs text-fg-subtle">
						{magnets.length > 0 && `${magnets.length} magnet${magnets.length === 1 ? "" : "s"}`}
						{magnets.length > 0 && files.length > 0 && " · "}
						{files.length > 0 && `${files.length} file${files.length === 1 ? "" : "s"}`}
						{nothingToAdd && "or drop files here"}
					</span>
				</div>

				{files.length > 0 && (
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{files.map((f, i) => (
							<li
								key={f.name}
								className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-fg-muted"
							>
								<span className="max-w-40 truncate">{f.name}</span>
								<button
									type="button"
									aria-label={`Remove ${f.name}`}
									onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
									className="text-fg-subtle hover:text-fg cursor-pointer"
								>
									×
								</button>
							</li>
						))}
					</ul>
				)}
			</div>

			{error && (
				<p role="alert" className="mt-3 text-xs text-status-errored">
					{error}
				</p>
			)}

			{result && <ResultList result={result} />}

			<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button
					variant="subtle"
					onClick={() => {
						reset();
						onClose();
					}}
					className="justify-center"
				>
					{result ? "Done" : "Cancel"}
				</Button>
				<Button
					variant="primary"
					disabled={nothingToAdd || submit.isPending}
					onClick={() => submit.mutate()}
					className="justify-center"
				>
					{submit.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
					Add {magnets.length + files.length > 0 ? magnets.length + files.length : ""}
				</Button>
			</div>
		</Dialog>
	);
}
