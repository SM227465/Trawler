"use client";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Wraps the native <dialog>. Using the platform element rather than a portal
 * gives us focus trapping, Esc-to-close, `inert` on the background and top-layer
 * stacking for free — no z-index wars, no focus-trap dependency.
 */
export function Dialog({
	open,
	onClose,
	title,
	description,
	children,
	labelledBy = "dialog-title",
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children: React.ReactNode;
	labelledBy?: string;
}) {
	const ref = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	}, [open]);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click; native <dialog> already closes on Escape
		<dialog
			ref={ref}
			aria-labelledby={labelledBy}
			onClose={onClose}
			// Clicking the backdrop closes. The dialog element itself fills the
			// viewport, so we compare the target to distinguish backdrop from panel.
			// The keyboard equivalent is not missing — the native <dialog> closes on
			// Escape by itself, which is exactly what a key handler here would add.
			onClick={(e) => {
				if (e.target === ref.current) onClose();
			}}
			className={cn(
				"ct-dialog m-auto w-[calc(100vw-2rem)] max-w-md p-0",
				"rounded-[var(--ct-radius)] border border-border bg-surface text-fg",
				"shadow-[var(--ct-shadow-lg)]",
			)}
		>
			<div className="p-5">
				<div className="flex items-start gap-3">
					<div className="min-w-0 flex-1">
						<h2 id={labelledBy} className="text-base font-semibold">
							{title}
						</h2>
						{description && <p className="mt-1.5 text-sm text-fg-muted">{description}</p>}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-[var(--ct-radius-sm)] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>

				{children}
			</div>
		</dialog>
	);
}
