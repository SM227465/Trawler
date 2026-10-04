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
	// Set while we re-open the dialog ourselves, so the `close` event that comes
	// with it is not mistaken for the user closing the dialog.
	const reasserting = useRef(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	}, [open]);

	/**
	 * Puts the dialog back in the top layer if it falls out of it.
	 *
	 * Chrome on Android makes a playing <video> fullscreen when the phone is
	 * rotated. Leaving fullscreen can drop the dialog that contained it out of
	 * the top layer while its `open` attribute stays set: still open by every
	 * test the effect above makes, no longer painted by anything. The film
	 * simply vanished mid-scene, and nothing brought it back.
	 *
	 * `:modal` is the only honest test for "is actually the top-layer modal",
	 * and close()+showModal() is the only way back — showModal() on an already
	 * open dialog throws. Neither touches the <video> element, so playback
	 * continues across the repair.
	 *
	 * A no-op in the normal case, which is most of the time this runs.
	 */
	useEffect(() => {
		if (!open) return;
		const el = ref.current;
		if (!el) return;

		const reassert = () => {
			// Fullscreen owns the screen while it lasts; repair on the way out.
			if (document.fullscreenElement || !el.open) return;
			try {
				if (el.matches(":modal")) return;
			} catch {
				return; // no :modal support — no reliable test, so no blind repair
			}

			reasserting.current = true;
			el.close();
			el.showModal();
			// The close event is queued, not synchronous, so the flag cannot be
			// cleared on the next line. Cleared by the handler that swallows it,
			// with this as the backstop if it never arrives.
			setTimeout(() => {
				reasserting.current = false;
			}, 500);
		};

		document.addEventListener("fullscreenchange", reassert);
		// Rotation without fullscreen, and any other viewport change. Guarded by
		// the :modal test above, so it costs a selector match.
		window.addEventListener("resize", reassert);
		return () => {
			document.removeEventListener("fullscreenchange", reassert);
			window.removeEventListener("resize", reassert);
		};
	}, [open]);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click; native <dialog> already closes on Escape
		<dialog
			ref={ref}
			aria-labelledby={labelledBy}
			onClose={() => {
				// Our own repair above closes and immediately reopens. That close is
				// not the user's, and acting on it would shut the dialog for real.
				if (reasserting.current) {
					reasserting.current = false;
					return;
				}
				onClose();
			}}
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
						{/* break-words, because these are usually filenames. A release name
						    like `exploitedtalent.23.06.09.darcy.dark…mp4` is one unbroken
						    token with nothing to wrap at, so it set a min-content width
						    wider than the dialog and the whole panel scrolled sideways —
						    far enough that the content scrolled out of view. */}
						<h2 id={labelledBy} className="break-words text-base font-semibold">
							{title}
						</h2>
						{description && <p className="mt-1.5 break-words text-sm text-fg-muted">{description}</p>}
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
