"use client";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export function ConfirmDialog({
	open,
	onClose,
	onConfirm,
	title,
	description,
	confirmLabel = "Confirm",
	danger = false,
	busy = false,
	children,
}: {
	open: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title: string;
	description?: string;
	confirmLabel?: string;
	danger?: boolean;
	busy?: boolean;
	children?: React.ReactNode;
}) {
	const cancelRef = useRef<HTMLButtonElement>(null);

	// Focus Cancel, not Confirm. A destructive action should never be one
	// stray Enter away.
	useEffect(() => {
		if (open) requestAnimationFrame(() => cancelRef.current?.focus());
	}, [open]);

	return (
		<Dialog open={open} onClose={onClose} title={title} description={description}>
			{children && <div className="mt-4">{children}</div>}

			<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button ref={cancelRef} variant="subtle" onClick={onClose} disabled={busy} className="justify-center">
					Cancel
				</Button>
				<Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy} className="justify-center">
					{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
					{confirmLabel}
				</Button>
			</div>
		</Dialog>
	);
}
