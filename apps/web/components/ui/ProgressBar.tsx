import { cn } from "@/lib/cn";

const FILL: Record<string, string> = {
	downloading: "bg-status-downloading",
	completed: "bg-status-completed",
	paused: "bg-status-paused",
	errored: "bg-status-errored",
	queued: "bg-status-queued",
	evicted: "bg-status-queued",
};

export function ProgressBar({
	value,
	status = "downloading",
	className,
}: {
	value: number;
	status?: string;
	className?: string;
}) {
	const pct = Math.max(0, Math.min(1, value)) * 100;
	return (
		<div
			className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-inset", className)}
			role="progressbar"
			aria-valuenow={Math.round(pct)}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<div
				className={cn("h-full rounded-full transition-[width] duration-500 ease-out", FILL[status] ?? FILL.queued)}
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
}
