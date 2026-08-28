"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/api";

/**
 * Removes every share that can no longer serve anything. Only the dead ones —
 * revoking is the action for a link that still works, and a single button that
 * could kill a live share by accident is not worth the convenience.
 */
export function ClearDeadShares({ count }: { count: number }) {
	const qc = useQueryClient();
	const [confirming, setConfirming] = useState(false);

	const clear = useMutation({
		mutationFn: () => api.clearDeadShares(),
		onSuccess: () => {
			setConfirming(false);
			qc.invalidateQueries({ queryKey: ["shares"] });
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
				confirmLabel={`Delete ${count} link${count === 1 ? "" : "s"}`}
				title="Clear the links that no longer work?"
			>
				<p className="text-sm text-fg-muted">
					{count} revoked, expired or used-up link{count === 1 ? "" : "s"} will be deleted permanently. Links that still
					work are not touched.
				</p>
				<p className="mt-2 text-sm text-fg-muted">
					Their access history goes too — if you want to know who used one of these, check it under Activity first.
				</p>
				{clear.isError && <p className="mt-2 text-sm text-status-errored">Could not clear those links.</p>}
			</ConfirmDialog>
		</>
	);
}
