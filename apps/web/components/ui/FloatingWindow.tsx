"use client";
import { Maximize2, Minimize2, X } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type Geometry = { x: number; y: number; w: number; h: number };
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type Gesture = { kind: "move" | Edge; px: number; py: number; start: Geometry };

const MIN_W = 320;
const MIN_H = 220;
/** The title bar's height (h-11). It never leaves the screen, so the window can always be grabbed back. */
const TITLE_H = 44;
/** Pixels of the window that stay on screen when it is dragged off a side. */
const KEEP_VISIBLE = 96;
/** Each further window opens this far down and right of the last, not exactly on top of it. */
const CASCADE = 28;

const storageKey = (key: string) => `ct-window:${key}`;

function readSaved(key: string): { geometry: Geometry | null; maximized: boolean } {
	try {
		const v = JSON.parse(localStorage.getItem(storageKey(key)) ?? "null");
		const g = v?.geometry;
		const valid = g && ["x", "y", "w", "h"].every((k) => typeof g[k] === "number");
		return { geometry: valid ? g : null, maximized: v?.maximized === true };
	} catch {
		return { geometry: null, maximized: false }; // blocked or corrupt storage: the default is fine
	}
}

function save(key: string, geometry: Geometry, maximized: boolean) {
	try {
		localStorage.setItem(storageKey(key), JSON.stringify({ geometry, maximized }));
	} catch {
		/* the window simply opens at its default next time */
	}
}

/**
 * Fits a window into the viewport as it is NOW. A size and place remembered
 * on a big monitor still have to work when the same browser opens on a laptop.
 */
function clamp(g: Geometry): Geometry {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const w = Math.min(Math.max(g.w, MIN_W), vw);
	const h = Math.min(Math.max(g.h, MIN_H), vh);
	return {
		w,
		h,
		x: Math.min(Math.max(g.x, KEEP_VISIBLE - w), vw - KEEP_VISIBLE),
		y: Math.min(Math.max(g.y, 0), vh - TITLE_H),
	};
}

function centred(size: { w: number; h: number }): Geometry {
	const w = Math.min(size.w, window.innerWidth - 32);
	const h = Math.min(size.h, window.innerHeight - 32);
	return clamp({ x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2, w, h });
}

/**
 * Resizing from an edge or corner. The opposite side stays put, as in any
 * desktop window manager: dragging the left edge moves x and changes width.
 */
function resize(s: Geometry, edge: Edge, dx: number, dy: number): Geometry {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	let { x, y, w, h } = s;
	if (edge.includes("e")) w = Math.max(MIN_W, Math.min(s.w + dx, vw - s.x));
	if (edge.includes("s")) h = Math.max(MIN_H, Math.min(s.h + dy, vh - s.y));
	if (edge.includes("w")) {
		const right = s.x + s.w;
		x = Math.min(Math.max(s.x + dx, 0), right - MIN_W);
		w = right - x;
	}
	if (edge.includes("n")) {
		const bottom = s.y + s.h;
		y = Math.min(Math.max(s.y + dy, 0), bottom - MIN_H);
		h = bottom - y;
	}
	return { x, y, w, h };
}

/** Thin strips along each side and squares at each corner, just outside the border so they are easy to hit. */
const HANDLES: Array<{ edge: Edge; className: string }> = [
	{ edge: "n", className: "inset-x-3 -top-1 h-2 cursor-ns-resize" },
	{ edge: "s", className: "inset-x-3 -bottom-1 h-2 cursor-ns-resize" },
	{ edge: "w", className: "inset-y-3 -left-1 w-2 cursor-ew-resize" },
	{ edge: "e", className: "inset-y-3 -right-1 w-2 cursor-ew-resize" },
	{ edge: "nw", className: "-top-1 -left-1 size-4 cursor-nwse-resize" },
	{ edge: "ne", className: "-top-1 -right-1 size-4 cursor-nesw-resize" },
	{ edge: "sw", className: "-bottom-1 -left-1 size-4 cursor-nesw-resize" },
	{ edge: "se", className: "-bottom-1 -right-1 size-4 cursor-nwse-resize" },
];

/** The last-touched window is on top. Above the app's popovers, below its toasts. */
let topZ = 40;
/** Windows open right now, for the cascade. */
let openWindows = 0;

/**
 * Phones get the whole screen instead of a window: there is no room for one,
 * and no mouse to drag it with.
 */
const COMPACT_QUERY = "(max-width: 639px)";
const subscribeCompact = (cb: () => void) => {
	const mq = window.matchMedia(COMPACT_QUERY);
	mq.addEventListener("change", cb);
	return () => mq.removeEventListener("change", cb);
};
const useCompact = () =>
	useSyncExternalStore(
		subscribeCompact,
		() => window.matchMedia(COMPACT_QUERY).matches,
		() => false,
	);

interface Props {
	open: boolean;
	onClose: () => void;
	title: string;
	/** Where this window's size, place and maximized state are remembered in this browser. */
	storageKey: string;
	/** The first-ever size, before the user has chosen one. */
	defaultSize: { w: number; h: number };
	children: ReactNode;
}

/**
 * A window, the desktop kind: dragged by its title bar, resized from any edge
 * or corner, maximized by its button or a double-click on the title bar. It
 * remembers where it was.
 *
 * Deliberately NOT modal. The page behind stays usable — keep watching while
 * browsing for the next file, open a second one beside it — so there is no
 * backdrop, no focus trap and no top layer, just a fixed element in a portal
 * so no scrolling or clipped ancestor can trap it. Escape still closes it
 * while focus is inside.
 */
export function FloatingWindow(props: Props) {
	if (!props.open || typeof document === "undefined") return null;
	return createPortal(<Window {...props} />, document.body);
}

function Window({ onClose, title, storageKey: key, defaultSize, children }: Omit<Props, "open">) {
	const titleId = useId();
	const ref = useRef<HTMLDivElement>(null);
	const compact = useCompact();

	const [maximized, setMaximized] = useState(() => readSaved(key).maximized);
	// Mounted only on the client (the window exists only once opened), so
	// storage and the viewport are safe to read while initialising.
	const [geometry, setGeometry] = useState<Geometry>(() => {
		const saved = readSaved(key).geometry;
		const base = saved ? clamp(saved) : centred(defaultSize);
		const offset = openWindows * CASCADE;
		return clamp({ ...base, x: base.x + offset, y: base.y + offset });
	});
	const [z, setZ] = useState(() => ++topZ);
	const [interacting, setInteracting] = useState(false);
	const gesture = useRef<Gesture | null>(null);
	const latest = useRef({ geometry, maximized });
	latest.current = { geometry, maximized };

	// Focus moves in, so Escape and the keyboard reach the window; it goes back
	// to whatever opened it on close.
	useEffect(() => {
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		ref.current?.focus({ preventScroll: true });
		openWindows++;
		return () => {
			openWindows--;
			opener?.focus({ preventScroll: true });
		};
	}, []);

	// A browser window made smaller must not strand this one off-screen.
	useEffect(() => {
		const refit = () => setGeometry((g) => clamp(g));
		window.addEventListener("resize", refit);
		return () => window.removeEventListener("resize", refit);
	}, []);

	const raise = () => {
		if (z !== topZ) setZ(++topZ);
	};

	const toggleMaximized = () => {
		const next = !latest.current.maximized;
		setMaximized(next);
		save(key, latest.current.geometry, next);
	};

	const begin = (kind: Gesture["kind"], e: ReactPointerEvent<HTMLElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		let start = latest.current.geometry;
		if (kind === "move" && latest.current.maximized) {
			// Pulling a maximized window by its title bar restores it under the
			// pointer, keeping the grab point in proportion — as desktops do.
			const ratio = e.clientX / window.innerWidth;
			start = clamp({ ...start, x: e.clientX - start.w * ratio, y: 0 });
			setMaximized(false);
			setGeometry(start);
		}
		gesture.current = { kind, px: e.clientX, py: e.clientY, start };
		setInteracting(true);
	};

	const move = (e: ReactPointerEvent<HTMLElement>) => {
		const g = gesture.current;
		if (!g) return;
		const dx = e.clientX - g.px;
		const dy = e.clientY - g.py;
		setGeometry(
			g.kind === "move" ? clamp({ ...g.start, x: g.start.x + dx, y: g.start.y + dy }) : resize(g.start, g.kind, dx, dy),
		);
	};

	const end = () => {
		if (!gesture.current) return;
		gesture.current = null;
		setInteracting(false);
		save(key, latest.current.geometry, false);
	};

	const gestureHandlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
	const onTitleBar = (e: ReactPointerEvent | ReactMouseEvent) => !(e.target as HTMLElement).closest("button");
	const fill = compact || maximized;

	return (
		<div
			ref={ref}
			role="dialog"
			aria-modal="false"
			aria-labelledby={titleId}
			tabIndex={-1}
			onPointerDownCapture={raise}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					onClose();
				}
			}}
			style={
				fill ? { zIndex: z } : { zIndex: z, left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h }
			}
			className={cn(
				"fixed flex flex-col border border-border bg-surface text-fg shadow-[var(--ct-shadow-lg)] outline-none",
				fill ? "inset-0" : "rounded-[var(--ct-radius)]",
			)}
		>
			{/* The title bar is the handle, as on every desktop. Its buttons are not. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer drag handle; the keyboard has Maximize, Close and Escape */}
			<div
				onPointerDown={compact ? undefined : (e) => onTitleBar(e) && begin("move", e)}
				onDoubleClick={compact ? undefined : (e) => onTitleBar(e) && toggleMaximized()}
				{...gestureHandlers}
				className={cn(
					"flex h-11 shrink-0 touch-none select-none items-center gap-1 border-b border-border pr-1.5 pl-4",
					!compact && (interacting ? "cursor-grabbing" : "cursor-grab"),
				)}
			>
				<h2 id={titleId} title={title} className="min-w-0 flex-1 truncate text-sm font-semibold">
					{title}
				</h2>
				{!compact && (
					<button
						type="button"
						onClick={toggleMaximized}
						aria-label={maximized ? "Restore" : "Maximize"}
						title={maximized ? "Restore" : "Maximize"}
						className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
					>
						{maximized ? (
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
					title="Close"
					className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
				>
					<X className="size-4" aria-hidden />
				</button>
			</div>

			{/* While dragging, the content ignores the pointer: an iframe (the PDF
			    reader) would otherwise swallow the moves and strand the gesture. */}
			<div className={cn("flex min-h-0 flex-1 flex-col overflow-auto p-4", interacting && "pointer-events-none")}>
				{children}
			</div>

			{!fill &&
				HANDLES.map(({ edge, className }) => (
					<div
						key={edge}
						aria-hidden
						onPointerDown={(e) => begin(edge, e)}
						{...gestureHandlers}
						className={cn("absolute touch-none", className)}
					/>
				))}
		</div>
	);
}
