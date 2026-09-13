"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CloudUpload, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { UPLOADS_KEY } from "@/lib/useUploads";

/**
 * Copies one path to a configured remote.
 *
 * Renders nothing when no storage is connected — an upload button with nowhere
 * to upload to is a dead end, and the Storage page is where you go to fix that.
 * With exactly one remote it is a single button; with several it asks which.
 */
export function UploadToRemote({ path, name }: { path: string; name: string }) {
	const qc = useQueryClient();
	const router = useRouter();
	const toast = useToast();
	const [choosing, setChoosing] = useState(false);
	const { data } = useQuery({ queryKey: ["remotes"], queryFn: api.remotes, staleTime: 60_000 });

	// A check mark on the button says "accepted" and nothing more, on a page
	// that then shows no sign the transfer exists. The toast carries where it
	// went and a way to go and watch it.
	const send = useMutation({
		mutationFn: (remote: string) => api.startUpload(remote, path),
		onSuccess: (_row, remote) => {
			setChoosing(false);
			qc.invalidateQueries({ queryKey: UPLOADS_KEY });
			toast(`Queued — ${name} → ${remote}`, {
				action: { label: "View", onClick: () => router.push("/cloud") },
			});
		},
		// The server refuses a transfer that cannot fit, and that refusal names
		// the two numbers. Swallowing it would put the user back where they were:
		// clicking upload and being told nothing.
		onError: (err) => {
			setChoosing(false);
			toast(err instanceof Error ? err.message : "Could not queue that transfer", { tone: "error" });
		},
	});

	const remotes = data?.remotes ?? [];
	if (!data?.available || remotes.length === 0) return null;

	const go = () => (remotes.length === 1 ? send.mutate(remotes[0].name) : setChoosing((c) => !c));

	return (
		<span className="relative">
			<button
				type="button"
				onClick={go}
				disabled={send.isPending}
				aria-label={`Upload ${name} to storage`}
				title={send.isSuccess ? "Queued" : "Upload to storage"}
				className={cn(
					"grid size-7 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)]",
					"text-fg-subtle transition-colors hover:bg-surface-inset hover:text-accent",
					"disabled:pointer-events-none disabled:opacity-50",
				)}
			>
				{send.isPending ? (
					<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
				) : send.isSuccess ? (
					<Check className="size-3.5 text-status-completed" aria-hidden />
				) : (
					<CloudUpload className="size-3.5" aria-hidden />
				)}
			</button>

			{choosing && remotes.length > 1 && (
				<span
					className={cn(
						"absolute right-0 top-8 z-20 flex min-w-40 flex-col overflow-hidden rounded-[var(--ct-radius-sm)]",
						"border border-border bg-surface shadow-[var(--ct-shadow-lg)]",
					)}
				>
					{remotes.map((r) => (
						<button
							key={r.name}
							type="button"
							onClick={() => send.mutate(r.name)}
							className="cursor-pointer px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
						>
							{r.name}
						</button>
					))}
				</span>
			)}

			{send.isError && (
				<span className="absolute right-0 top-8 z-20 w-48 rounded-[var(--ct-radius-sm)] border border-border bg-surface px-2 py-1.5 text-xs text-status-errored shadow-[var(--ct-shadow-lg)]">
					{send.error instanceof Error ? send.error.message : "Could not start that upload."}
				</span>
			)}
		</span>
	);
}
