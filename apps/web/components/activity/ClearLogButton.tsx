"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/api";

/**
 * Empties one feed. The clear is itself recorded, so the Account tab will show
 * "Cleared the log" with the number of entries removed — the history can be
 * emptied, but not without leaving that behind.
 */
export function ClearLogButton({ target, label }: { target: "audit" | "shares"; label: string }) {
	const qc = useQueryClient();
	const [confirming, setConfirming] = useState(false);

	const clear = useMutation({
		mutationFn: () => api.clearAudit(target),
		onSuccess: () => {
			setConfirming(false);
			qc.invalidateQueries({ queryKey: ["audit"] });
			qc.invalidateQueries({ queryKey: ["share-access-feed"] });
		},
	});

	return (
		<>
			<Button size="sm" variant="ghost" onClick={() => setConfirming(true)} className="hover:text-danger">
				<Trash2 className="size-3.5" aria-hidden />
				Clear
			</Button>

			<ConfirmDialog
				open={confirming}
				onClose={() => setConfirming(false)}
				onConfirm={() => clear.mutate()}
				busy={clear.isPending}
				danger
				confirmLabel="Clear the log"
				title={`Clear ${label}?`}
			>
				<p className="text-sm text-fg-muted">
					Every entry is deleted permanently. This is the record of who signed in and who used your links — if you are
					clearing it to investigate something, read it first.
				</p>
				<p className="mt-2 text-sm text-fg-muted">
					The clear itself is logged, including how many entries were removed.
				</p>
				{clear.isError && <p className="mt-2 text-sm text-status-errored">Could not clear the log.</p>}
			</ConfirmDialog>
		</>
	);
}
