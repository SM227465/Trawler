"use client";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** A size the user chose: pixels from dragging, or the whole viewport. Null is the default. */
type PanelSize = { w: number; h: number } | "max" | null;

const MIN_W = 320;
const MIN_H = 240;
/** Per keypress, for resizing from the keyboard. */
const KEY_STEP = 32;

const sizeStorageKey = (key: string) => `ct-dialog-size:${key}`;

function readSize(key: string): PanelSize {
	try {
		const raw = localStorage.getItem(sizeStorageKey(key));
		if (!raw) return null;
		const v = JSON.parse(raw) as PanelSize;
		if (v === "max") return v;
		return v && typeof v.w === "number" && typeof v.h === "number" ? v : null;
	} catch {
		return null; // private mode, blocked storage, or a corrupt value — the default size is fine
	}
}

function writeSize(key: string, size: PanelSize) {
	try {
		if (size) localStorage.setItem(sizeStorageKey(key), JSON.stringify(size));
		else localStorage.removeItem(sizeStorageKey(key));
	} catch {
		/* ignore — the size simply is not remembered */
	}
}

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
	resizeKey,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children: React.ReactNode;
	labelledBy?: string;
	/**
	 * Makes the panel resizable — a drag handle in the corner and a maximize
	 * button — and remembers the chosen size in this browser under this key.
	 * While a size is set the panel carries `data-sized`, so content can grow
	 * into it with `group-data-[sized]/dialog:` variants.
	 */
	resizeKey?: string;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const [size, setSize] = useState<PanelSize>(null);
	const latest = useRef<PanelSize>(null);
	const drag = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

	// Read on open rather than at render: storage does not exist on the server,
	// and the remembered size belongs to this browser, not to the page.
	useEffect(() => {
		if (open && resizeKey) {
			const remembered = readSize(resizeKey);
			latest.current = remembered;
			setSize(remembered);
		}
	}, [open, resizeKey]);

	const apply = (next: PanelSize, persist: boolean) => {
		latest.current = next;
		setSize(next);
		if (persist && resizeKey) writeSize(resizeKey, next);
	};

	const nudge = (dw: number, dh: number) => {
		const rect = ref.current?.getBoundingClientRect();
		if (!rect) return;
		apply({ w: Math.max(MIN_W, rect.width + dw), h: Math.max(MIN_H, rect.height + dh) }, true);
	};
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
			data-sized={size ? "" : undefined}
			// min() rather than a stored clamp: a size chosen on a big monitor still
			// fits when the same browser later opens on a smaller window.
			style={
				size === "max"
					? { width: "calc(100vw - 2rem)", height: "calc(100dvh - 2rem)" }
					: size
						? { width: `min(${size.w}px, calc(100vw - 2rem))`, height: `min(${size.h}px, calc(100dvh - 2rem))` }
						: undefined
			}
			className={cn(
				"ct-dialog group/dialog m-auto w-[calc(100vw-2rem)] p-0",
				size ? "max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-auto" : "max-w-md",
				"rounded-[var(--ct-radius)] border border-border bg-surface text-fg",
				"shadow-[var(--ct-shadow-lg)]",
			)}
		>
			{/* A column that fills a sized panel, so whatever the content marks
			    flex-1 takes up the extra room. Without a size it is just a box. */}
			<div className={cn("p-5", size && "flex h-full flex-col")}>
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
					{resizeKey && (
						<button
							type="button"
							onClick={() => apply(size === "max" ? null : "max", true)}
							aria-label={size === "max" ? "Restore size" : "Maximize"}
							title={size === "max" ? "Restore size" : "Maximize"}
							className="-mt-1 grid size-7 shrink-0 place-items-center rounded-[var(--ct-radius-sm)] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
						>
							{size === "max" ? (
								<Minimize2 className="size-3.5" aria-hidden />
							) : (
								<Maximize2 className="size-3.5" aria-hidden />
							)}
						</button>
					)}
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

			{resizeKey && (
				<button
					type="button"
					aria-label="Resize. Arrow keys change the size; Enter goes back to the default."
					title="Drag to resize — double-click for the default size"
					// The panel is centred by margin:auto, so it grows on BOTH sides at
					// once: twice the pointer's travel keeps the corner under the
					// pointer. Plain `resize: both` moves the corner half as far as the
					// cursor, and does nothing at all on a touch screen.
					onPointerDown={(e) => {
						const rect = ref.current?.getBoundingClientRect();
						if (!rect) return;
						e.preventDefault();
						e.currentTarget.setPointerCapture(e.pointerId);
						drag.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
					}}
					onPointerMove={(e) => {
						const d = drag.current;
						if (!d) return;
						apply(
							{
								w: Math.max(MIN_W, d.w + 2 * (e.clientX - d.x)),
								h: Math.max(MIN_H, d.h + 2 * (e.clientY - d.y)),
							},
							false,
						);
					}}
					onPointerUp={() => {
						if (!drag.current) return;
						drag.current = null;
						if (resizeKey) writeSize(resizeKey, latest.current);
					}}
					onPointerCancel={() => {
						drag.current = null;
					}}
					onDoubleClick={() => apply(null, true)}
					onKeyDown={(e) => {
						const step = {
							ArrowRight: [KEY_STEP, 0],
							ArrowLeft: [-KEY_STEP, 0],
							ArrowDown: [0, KEY_STEP],
							ArrowUp: [0, -KEY_STEP],
						}[e.key];
						if (step) {
							e.preventDefault();
							nudge(step[0], step[1]);
						} else if (e.key === "Enter") {
							e.preventDefault();
							apply(null, true);
						}
					}}
					// touch-none: otherwise a drag on a phone scrolls the page instead.
					className="absolute right-0 bottom-0 grid size-5 cursor-nwse-resize touch-none place-items-center rounded-br-[var(--ct-radius)] text-fg-subtle hover:text-fg focus-visible:text-fg"
				>
					<svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
						<path d="M9 3 3 9M9 6 6 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
					</svg>
				</button>
			)}
		</dialog>
	);
}
