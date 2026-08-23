import type { TorrentStatus } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * Colour comes from the semantic status tokens, so a status is the same colour
 * everywhere — chip, progress bar, and later the piece map legend.
 */
const STYLES: Record<string, string> = {
	downloading: "bg-status-downloading-soft text-status-downloading",
	completed: "bg-status-completed-soft text-status-completed",
	paused: "bg-status-paused-soft text-status-paused",
	errored: "bg-status-errored-soft text-status-errored",
	queued: "bg-status-queued-soft text-status-queued",
	evicted: "bg-status-queued-soft text-status-queued",
};

const LABELS: Record<string, string> = {
	downloading: "Downloading",
	completed: "Complete",
	paused: "Paused",
	errored: "Error",
	queued: "Queued",
	evicted: "Evicted",
};

export function StatusChip({ status, detail }: { status: TorrentStatus | string; detail?: string | null }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
				"text-xs font-medium whitespace-nowrap",
				STYLES[status] ?? STYLES.queued,
			)}
			title={detail ?? undefined}
		>
			<span className="size-1.5 rounded-full bg-current" aria-hidden />
			{LABELS[status] ?? status}
		</span>
	);
}
