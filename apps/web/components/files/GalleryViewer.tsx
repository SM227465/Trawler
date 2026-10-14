"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	FileImage,
	LoaderCircle,
	Maximize,
	Minimize,
	RotateCcw,
	RotateCw,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { api, type BrowseEntry, browseThumbUrl } from "@/lib/api";
import { asAttachment } from "@/lib/attachment";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { useCopy } from "@/lib/useCopy";

/** Download tokens live four hours; re-mint well inside that. */
const LINK_STALE_MS = 30 * 60_000;
const linkQuery = (path: string) => ({
	queryKey: ["browse-link", path],
	queryFn: () => api.browseLink(path),
	staleTime: LINK_STALE_MS,
});

/** One zoom step from a button or the keyboard. */
const STEP = 1.25;
/** A horizontal drag this long on an unzoomed photo turns the page. */
const SWIPE_PX = 60;

/** Zoom is relative to the fitted size (1 = whole photo in view); x and y pan from the centre. */
type View = { zoom: number; x: number; y: number };
const FIT: View = { zoom: 1, x: 0, y: 0 };
type Point = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * A photo viewer for one folder: next and previous without closing anything,
 * plus zoom, pan, rotate and full screen.
 *
 * Every image is a token-authenticated /dl/ URL, minted on demand and cached;
 * the two neighbours are minted and their bytes fetched in the background, so
 * stepping through a folder is instant. Rotation is a view, like in any photo
 * viewer — the file on disk is never touched.
 */
export function GalleryViewer({
	items,
	startPath,
	onClose,
}: {
	/** The folder's photos, in the order the folder is showing them. */
	items: BrowseEntry[];
	startPath: string;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const { copied, copy } = useCopy();
	const [path, setPath] = useState(startPath);
	const index = items.findIndex((i) => i.path === path);
	const item = items[index] as BrowseEntry | undefined;
	const lastIndex = useRef(Math.max(index, 0));

	// The folder refreshes while this is open. If the photo on screen was
	// deleted or renamed, show its neighbour; with no photos left, close.
	useEffect(() => {
		if (index >= 0) {
			lastIndex.current = index;
			return;
		}
		if (items.length === 0) onClose();
		else setPath(items[Math.min(lastIndex.current, items.length - 1)].path);
	}, [index, items, onClose]);

	const link = useQuery({ ...linkQuery(item?.path ?? ""), enabled: Boolean(item) });

	// Neighbours ready before they are asked for: the link minted, the bytes in
	// the browser's cache. Marked as background so the top loading bar ignores it.
	useEffect(() => {
		for (const n of [items[index + 1], items[index - 1]]) {
			if (!n) continue;
			qc.fetchQuery({ ...linkQuery(n.path), meta: { background: true } })
				.then((l) => {
					new Image().src = l.path;
				})
				.catch(() => {
					/* it will be fetched, and fail visibly, if the user goes there */
				});
		}
	}, [index, items, qc]);

	// Rotation is remembered per photo for as long as the gallery is open. The
	// count is unbounded (-90, 450…) so a turn always animates the short way.
	const [rotations, setRotations] = useState<Record<string, number>>({});
	const rotation = item ? (rotations[item.path] ?? 0) : 0;
	const [view, setView] = useState<View>(FIT);
	const viewRef = useRef(view);
	viewRef.current = view;
	const [natural, setNatural] = useState<{ path: string; w: number; h: number } | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const [animate, setAnimate] = useState(true);

	// The stage's size, which changes whenever the window is resized.
	const stageRef = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState({ w: 0, h: 0 });
	useLayoutEffect(() => {
		const el = stageRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const nat = natural && natural.path === item?.path ? natural : null;
	const turned = ((rotation % 180) + 180) % 180 === 90;
	const ew = nat ? (turned ? nat.h : nat.w) : 0;
	const eh = nat ? (turned ? nat.w : nat.h) : 0;
	// Never above 1: a small photo is shown at its own size, not blown up.
	const fit = nat && box.w && box.h ? Math.min(box.w / ew, box.h / eh, 1) : 1;
	// Up to four times the photo's own pixels, and never less than 4x the fitted view.
	const maxZoom = Math.max(4, 4 / fit);

	/** Keeps zoom in range and the photo's edges from being dragged inside the stage. */
	const settle = (v: View): View => {
		const zoom = clamp(v.zoom, 1, maxZoom);
		const limX = Math.max(0, (ew * fit * zoom - box.w) / 2);
		const limY = Math.max(0, (eh * fit * zoom - box.h) / 2);
		return { zoom, x: clamp(v.x, -limX, limX), y: clamp(v.y, -limY, limY) };
	};

	/** Zoom with point p (relative to the stage centre) staying put under the cursor. */
	const zoomAt = (factor: number, p: Point = { x: 0, y: 0 }) =>
		setView((v) => {
			const zoom = clamp(v.zoom * factor, 1, maxZoom);
			const k = zoom / v.zoom;
			return settle({ zoom, x: p.x - k * (p.x - v.x), y: p.y - k * (p.y - v.y) });
		});

	const go = (delta: number) => {
		const next = items[index + delta];
		if (!next) return;
		setPath(next.path);
		setView(FIT);
	};

	const rotate = (delta: number) => {
		if (!item) return;
		setRotations((r) => ({ ...r, [item.path]: (r[item.path] ?? 0) + delta }));
		setView(FIT);
	};

	const local = (e: { clientX: number; clientY: number }): Point => {
		const r = stageRef.current?.getBoundingClientRect();
		return r ? { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 } : { x: 0, y: 0 };
	};

	// The wheel zooms towards the cursor. Registered by hand because React's
	// wheel listener is passive, and the page must not scroll underneath.
	const wheel = useRef({ zoomAt, local });
	wheel.current = { zoomAt, local };
	useEffect(() => {
		const el = stageRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			wheel.current.zoomAt(Math.exp(-e.deltaY * 0.0015), wheel.current.local(e));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	// One pointer pans a zoomed photo or swipes an unzoomed one; two pinch.
	const pointers = useRef(new Map<number, Point>());
	const gesture = useRef<{ view: View; mid: Point; dist: number } | null>(null);
	const swipeFrom = useRef<Point | null>(null);

	const span = () => {
		const pts = [...pointers.current.values()];
		if (pts.length === 0) return null;
		if (pts.length === 1) return { mid: pts[0], dist: 0 };
		const [a, b] = pts;
		return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
	};

	/** A new baseline whenever a finger lands or lifts, so the photo never jumps. */
	const rebase = () => {
		const s = span();
		gesture.current = s ? { view: viewRef.current, ...s } : null;
	};

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		// The arrow buttons sit on the stage; capturing their pointer would eat the click.
		if ((e.target as HTMLElement).closest("button")) return;
		if (e.pointerType === "mouse" && e.button !== 0) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		pointers.current.set(e.pointerId, local(e));
		swipeFrom.current = pointers.current.size === 1 ? local(e) : null;
		setAnimate(false);
		rebase();
	};

	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		if (!pointers.current.has(e.pointerId)) return;
		pointers.current.set(e.pointerId, local(e));
		const g = gesture.current;
		const s = span();
		if (!g || !s) return;
		if (pointers.current.size > 1 && g.dist > 0) {
			// The point between the fingers stays between them; moving both pans.
			const zoom = clamp(g.view.zoom * (s.dist / g.dist), 1, maxZoom);
			const k = zoom / g.view.zoom;
			setView(settle({ zoom, x: s.mid.x - k * (g.mid.x - g.view.x), y: s.mid.y - k * (g.mid.y - g.view.y) }));
		} else if (g.view.zoom > 1) {
			setView(settle({ ...g.view, x: g.view.x + s.mid.x - g.mid.x, y: g.view.y + s.mid.y - g.mid.y }));
		}
	};

	const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
		if (!pointers.current.has(e.pointerId)) return;
		const from = swipeFrom.current;
		const to = local(e);
		pointers.current.delete(e.pointerId);
		if (e.type === "pointerup" && from && pointers.current.size === 0 && viewRef.current.zoom === 1) {
			const dx = to.x - from.x;
			if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(to.y - from.y)) go(dx < 0 ? 1 : -1);
		}
		if (pointers.current.size > 0) swipeFrom.current = null;
		rebase();
		if (pointers.current.size === 0) setAnimate(true);
	};

	// Full screen takes the gallery, not the window chrome around it.
	const rootRef = useRef<HTMLDivElement>(null);
	const [full, setFull] = useState(false);
	const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
	useEffect(() => {
		const sync = () => setFull(document.fullscreenElement === rootRef.current);
		document.addEventListener("fullscreenchange", sync);
		return () => document.removeEventListener("fullscreenchange", sync);
	}, []);
	const toggleFull = () => {
		if (document.fullscreenElement) void document.exitFullscreen();
		else void rootRef.current?.requestFullscreen().then(() => rootRef.current?.focus({ preventScroll: true }));
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.altKey || e.ctrlKey || e.metaKey) return;
		const actions: Record<string, () => void> = {
			ArrowRight: () => go(1),
			ArrowLeft: () => go(-1),
			PageDown: () => go(1),
			PageUp: () => go(-1),
			"+": () => zoomAt(STEP),
			"=": () => zoomAt(STEP),
			"-": () => zoomAt(1 / STEP),
			"0": () => setView(FIT),
			r: () => rotate(90),
			R: () => rotate(-90),
			f: () => canFullscreen && toggleFull(),
		};
		const act = actions[e.key];
		if (!act) return;
		e.preventDefault();
		act();
	};

	// The filmstrip follows along.
	const activeThumb = useRef<HTMLButtonElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the photo changes; the ref is read inside
	useEffect(() => {
		activeThumb.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
	}, [index]);

	const loading = Boolean(item) && !link.isError && failed !== item?.path && !nat;
	const broken = link.isError || (item && failed === item.path);

	return (
		<FloatingWindow
			open
			onClose={onClose}
			title={item?.name ?? "Photos"}
			storageKey="gallery"
			defaultSize={{ w: 1000, h: 720 }}
			flush
			onKeyDown={onKeyDown}
		>
			<div ref={rootRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col bg-surface outline-none">
				{/* biome-ignore lint/a11y/noStaticElementInteractions: pan, pinch and swipe; the keyboard has arrows, + - 0 and R */}
				<div
					ref={stageRef}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerEnd}
					onPointerCancel={onPointerEnd}
					onDoubleClick={(e) => (viewRef.current.zoom > 1 ? setView(FIT) : zoomAt(2.5, local(e)))}
					className={cn(
						"relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-media-stage",
						view.zoom > 1 && "cursor-grab active:cursor-grabbing",
					)}
				>
					{item && link.data && failed !== item.path && (
						// biome-ignore lint/performance/noImgElement: a token-authenticated /dl/ URL, which next/image cannot fetch
						<img
							key={item.path}
							src={link.data.path}
							alt={item.name}
							draggable={false}
							onLoad={(e) =>
								setNatural({ path: item.path, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
							}
							onError={() => setFailed(item.path)}
							style={
								nat
									? {
											width: nat.w * fit,
											height: nat.h * fit,
											transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) rotate(${rotation}deg) scale(${view.zoom})`,
										}
									: { transform: "translate(-50%, -50%)", visibility: "hidden" }
							}
							className={cn(
								"absolute top-1/2 left-1/2 max-w-none",
								animate && "transition-transform duration-200 ease-out",
							)}
						/>
					)}

					{loading && (
						<div className="absolute inset-0 grid place-items-center">
							<LoaderCircle className="size-6 animate-spin text-media-badge-fg" aria-hidden />
						</div>
					)}

					{broken && (
						<div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-media-badge-fg">
							This photo could not be shown here. Download it to open it in another app.
						</div>
					)}

					{index > 0 && (
						<StageArrow side="left" label="Previous photo (←)" onClick={() => go(-1)}>
							<ChevronLeft className="size-5" aria-hidden />
						</StageArrow>
					)}
					{index < items.length - 1 && (
						<StageArrow side="right" label="Next photo (→)" onClick={() => go(1)}>
							<ChevronRight className="size-5" aria-hidden />
						</StageArrow>
					)}
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5">
					<span className="tabular text-xs text-fg-muted">
						{index + 1} / {items.length}
					</span>
					{item && (
						<span className="tabular hidden truncate text-xs text-fg-subtle sm:inline">
							{formatBytes(item.sizeBytes)}
							{nat && ` · ${nat.w} × ${nat.h}`}
						</span>
					)}

					<div className="ml-auto flex items-center gap-0.5">
						<Tool label="Zoom out (−)" onClick={() => zoomAt(1 / STEP)} disabled={view.zoom <= 1}>
							<ZoomOut className="size-4" aria-hidden />
						</Tool>
						<button
							type="button"
							onClick={() => setView(FIT)}
							title="Fit to window (0)"
							className="tabular h-8 min-w-12 cursor-pointer rounded-[var(--ct-radius-sm)] px-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
						>
							{Math.round(fit * view.zoom * 100)}%
						</button>
						<Tool label="Zoom in (+)" onClick={() => zoomAt(STEP)} disabled={view.zoom >= maxZoom}>
							<ZoomIn className="size-4" aria-hidden />
						</Tool>
						<span className="mx-1 h-5 w-px bg-border" aria-hidden />
						<Tool label="Rotate left (Shift+R)" onClick={() => rotate(-90)}>
							<RotateCcw className="size-4" aria-hidden />
						</Tool>
						<Tool label="Rotate right (R)" onClick={() => rotate(90)}>
							<RotateCw className="size-4" aria-hidden />
						</Tool>
						{canFullscreen && (
							<Tool label={full ? "Exit full screen (F)" : "Full screen (F)"} onClick={toggleFull}>
								{full ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
							</Tool>
						)}
						<span className="mx-1 h-5 w-px bg-border" aria-hidden />
						<Tool
							label={copied ? "Copied" : "Copy download link"}
							onClick={() => link.data && copy(asAttachment(link.data.url))}
							disabled={!link.data}
						>
							{copied ? (
								<Check className="size-4 text-status-completed" aria-hidden />
							) : (
								<Copy className="size-4" aria-hidden />
							)}
						</Tool>
						<Tool
							label="Download"
							onClick={() => link.data && window.open(asAttachment(link.data.path), "_blank", "noopener")}
							disabled={!link.data}
						>
							<Download className="size-4" aria-hidden />
						</Tool>
					</div>
				</div>

				{items.length > 1 && (
					<div className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-border px-3 py-2">
						{items.map((it, i) => (
							<button
								key={it.path}
								ref={i === index ? activeThumb : undefined}
								type="button"
								onClick={() => {
									setPath(it.path);
									setView(FIT);
								}}
								aria-label={`Show ${it.name}`}
								aria-current={i === index ? "true" : undefined}
								title={it.name}
								className={cn(
									"grid h-14 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-[var(--ct-radius-sm)] bg-surface-inset transition-opacity",
									i === index ? "ring-2 ring-accent" : "opacity-60 hover:opacity-100",
								)}
							>
								{it.thumbnail ? (
									// biome-ignore lint/performance/noImgElement: a cookie-authenticated API route, which next/image cannot fetch
									<img src={browseThumbUrl(it)} alt="" loading="lazy" className="size-full object-cover" />
								) : (
									<FileImage className="size-5 text-fg-subtle" aria-hidden />
								)}
							</button>
						))}
					</div>
				)}
			</div>
		</FloatingWindow>
	);
}

function Tool({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
			className="grid size-8 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40"
		>
			{children}
		</button>
	);
}

/** The big previous/next targets over the photo, as in every photo viewer. */
function StageArrow({
	side,
	label,
	onClick,
	children,
}: {
	side: "left" | "right";
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={cn(
				"absolute top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full",
				"bg-media-badge text-media-badge-fg opacity-75 transition-opacity hover:opacity-100",
				side === "left" ? "left-3" : "right-3",
			)}
		>
			{children}
		</button>
	);
}
