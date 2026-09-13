"use client";
import { Upload as UploadIcon } from "lucide-react";
import { useUploads } from "@/lib/useUploads";
import { TransferRow } from "./TransferRow";

/**
 * What is moving right now, and what is waiting its turn.
 *
 * Only live transfers: finished ones are history, and history is a table you
 * page through rather than a list that grows under the thing you are watching.
 *
 * Two run at a time — the server's limit, not a display choice — so the queue
 * below them is real and its order is the order they will start in.
 */
export function UploadsPanel() {
	// Shared with the header indicator and the file browser's badges: one query,
	// one clock, one answer to what is transferring.
	const { data } = useUploads();

	// Running first, then the queue in the order the server will start it —
	// oldest first. The API returns newest-first, which for a queue would show
	// exactly the wrong order and make the next one to start look like the last.
	const live = (data ?? [])
		.filter((u) => u.status === "running" || u.status === "queued")
		.sort((a, b) =>
			a.status === b.status ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : a.status === "running" ? -1 : 1,
		);
	if (live.length === 0) return null;

	const running = live.filter((u) => u.status === "running").length;
	const waiting = live.length - running;

	return (
		<section className="rounded-[var(--ct-radius)] border border-border bg-surface">
			<div className="flex items-center gap-2 border-b border-border px-4 py-3">
				<UploadIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				<h2 className="text-sm font-medium text-fg">In progress</h2>
				<span className="ml-auto text-xs text-fg-subtle">
					{running} running{waiting > 0 && ` · ${waiting} waiting`}
				</span>
			</div>
			<ul>
				{live.map((u) => (
					<TransferRow key={u.id} upload={u} />
				))}
			</ul>
		</section>
	);
}
