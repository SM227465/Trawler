"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	CircleCheck,
	CircleX,
	LoaderCircle,
	RotateCw,
	Upload as UploadIcon,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { api, type Upload } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatEta, formatSince } from "@/lib/format";

const STATE = {
	queued: { label: "Waiting", tone: "text-fg-muted", icon: LoaderCircle, spin: false },
	running: { label: "Moving", tone: "text-accent", icon: LoaderCircle, spin: true },
	completed: { label: "Done", tone: "text-status-completed", icon: CircleCheck, spin: false },
	failed: { label: "Failed", tone: "text-status-errored", icon: CircleX, spin: false },
	cancelled: { label: "Cancelled", tone: "text-fg-subtle", icon: CircleX, spin: false },
} as const;

function Row({ upload }: { upload: Upload }) {
	const qc = useQueryClient();
	const cancel = useMutation({
		mutationFn: () => api.cancelUpload(upload.id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["uploads"] }),
	});

	const retry = useMutation({
		mutationFn: () => api.retryUpload(upload.id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["uploads"] }),
	});

	const s = STATE[upload.status];
	const Icon = s.icon;
	const live = upload.status === "running" || upload.status === "queued";
	// bytesTotal is only known once rclone has finished, so mid-transfer the
	// honest thing to show is bytes moved and a speed, not a fake percentage.
	const pct = upload.bytesTotal > 0 ? Math.min(100, (upload.bytesDone / upload.bytesTotal) * 100) : null;

	return (
		<li className="border-b border-border px-4 py-2.5 last:border-b-0">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<Icon className={cn("size-3.5 shrink-0", s.tone, s.spin && "animate-spin")} aria-hidden />
				{/* Direction is the difference between "my file went away" and "my
				    file came back" — worth more than a label saying "transfer". */}
				{upload.direction === "down" ? (
					<ArrowDown className="size-3 shrink-0 text-fg-subtle" aria-label="Restoring" />
				) : (
					<ArrowUp className="size-3 shrink-0 text-fg-subtle" aria-label="Uploading" />
				)}
				<span className="min-w-0 flex-1 truncate text-sm text-fg" title={upload.srcPath}>
					{upload.srcPath}
				</span>
				<span className={cn("shrink-0 text-xs", s.tone)}>{s.label}</span>
				<span className="tabular shrink-0 text-xs text-fg-subtle">
					{formatBytes(upload.bytesDone)}
					{upload.status === "running" && (upload.speedBps ?? 0) > 0 && ` · ${formatBytes(upload.speedBps ?? 0)}/s`}
					{upload.status === "running" && upload.etaSeconds ? ` · ${formatEta(upload.etaSeconds)}` : ""}
					{!live && upload.finishedAt && ` · ${formatSince(upload.finishedAt)}`}
				</span>
				{live && (
					<Button
						size="icon"
						variant="ghost"
						onClick={() => cancel.mutate()}
						disabled={cancel.isPending}
						title="Stop this upload"
						aria-label={`Stop uploading ${upload.srcPath}`}
						className="hover:text-danger"
					>
						<X className="size-3.5" />
					</Button>
				)}
				{(upload.status === "failed" || upload.status === "cancelled") && (
					<Button
						size="icon"
						variant="ghost"
						onClick={() => retry.mutate()}
						disabled={retry.isPending}
						title="Try this transfer again"
						aria-label={`Retry ${upload.srcPath}`}
					>
						<RotateCw className={cn("size-3.5", retry.isPending && "animate-spin")} />
					</Button>
				)}
			</div>

			{/* The reason it failed is the whole point of offering a retry —
			    without it you are just clicking the same button hopefully. */}
			{upload.status === "failed" && upload.error && (
				<p className="mt-1 pl-6 text-xs text-status-errored" title={upload.error}>
					{upload.error}
				</p>
			)}

			{upload.status === "running" && (
				<div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-inset">
					<div
						className={cn(
							"h-full rounded-full bg-accent transition-[width] duration-500",
							pct === null && "w-1/3 animate-pulse",
						)}
						style={pct === null ? undefined : { width: `${pct}%` }}
					/>
				</div>
			)}

			{upload.error && (
				<p className="mt-1 text-xs text-status-errored" title={upload.error}>
					{upload.error}
				</p>
			)}
		</li>
	);
}

export function UploadsPanel() {
	const qc = useQueryClient();
	const { data } = useQuery({
		queryKey: ["uploads"],
		queryFn: api.uploads,
		// Only while something is moving. Progress comes from rclone, so this is
		// the one place in the app that genuinely needs polling.
		refetchInterval: (q) =>
			(q.state.data ?? []).some((u) => u.status === "running" || u.status === "queued") ? 2000 : false,
	});

	const clear = useMutation({
		mutationFn: () => api.clearFinishedUploads(),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["uploads"] }),
	});

	if (!data || data.length === 0) return null;
	const finished = data.filter((u) => u.status !== "running" && u.status !== "queued").length;

	return (
		<section className="rounded-[var(--ct-radius)] border border-border bg-surface">
			<div className="flex items-center gap-2 border-b border-border px-4 py-3">
				<UploadIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				<h2 className="text-sm font-medium text-fg">Transfers to storage</h2>
				{finished > 0 && (
					<span className="ml-auto">
						<Button size="sm" variant="ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>
							Clear finished
						</Button>
					</span>
				)}
			</div>
			<ul>
				{data.map((u) => (
					<Row key={u.id} upload={u} />
				))}
			</ul>
		</section>
	);
}
