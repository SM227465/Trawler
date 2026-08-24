"use client";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { SECTIONS } from "./sections";

/**
 * Mobile navigation.
 *
 * Replaces a horizontally-scrolling strip of sections. That strip had two
 * problems on a phone: the active item could sit off-screen, so you could not
 * tell where you were, and there was no affordance saying more existed to the
 * right. Seven sections do not fit a bottom tab bar either, so this is a
 * drawer — one tap to open, everything visible at once, labels and hints
 * included.
 *
 * Native <dialog> again, for the same reasons Dialog uses it: focus trapping,
 * Esc-to-close, `inert` on the background and top-layer stacking, all free.
 */
export function MobileNav() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	}, [open]);

	// A tap that navigates must also dismiss the drawer. Keyed on pathname so it
	// closes on the route change itself, not on the click — which also covers
	// back/forward and any programmatic navigation.
	// biome-ignore lint/correctness/useExhaustiveDependencies: closing is the effect of navigating
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
	const current = SECTIONS.find((s) => isActive(s.href));

	return (
		<div className="lg:hidden">
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label="Open navigation"
				aria-expanded={open}
				className={cn(
					"flex items-center gap-2 rounded-[var(--ct-radius-sm)] px-2 py-1.5",
					"text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
				)}
			>
				<Menu className="size-5 shrink-0" aria-hidden />
				{/* Naming the section here is what the scroller could not do: you can
				    always see where you are without opening anything. */}
				<span className="max-w-[9rem] truncate text-sm font-medium text-fg">{current?.label ?? "Menu"}</span>
			</button>

			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click; native <dialog> handles Escape */}
			<dialog
				ref={ref}
				aria-label="Sections"
				onClose={() => setOpen(false)}
				onClick={(e) => {
					if (e.target === ref.current) setOpen(false);
				}}
				className={cn(
					"ct-sheet m-0 h-dvh max-h-dvh w-72 max-w-[85vw] p-0",
					"border-r border-border bg-surface text-fg",
				)}
			>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<span className="text-sm font-semibold">Trawler</span>
					<button
						type="button"
						onClick={() => setOpen(false)}
						aria-label="Close navigation"
						className="grid size-8 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)] text-fg-subtle hover:bg-surface-2 hover:text-fg"
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>

				<ul className="p-2">
					{SECTIONS.map((s) => {
						const active = isActive(s.href);
						const Icon = s.icon;
						return (
							<li key={s.href}>
								<Link
									href={s.href}
									aria-current={active ? "page" : undefined}
									className={cn(
										"flex items-start gap-3 rounded-[var(--ct-radius-sm)] px-3 py-2.5 transition-colors",
										active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
									)}
								>
									<Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
									<span className="min-w-0">
										<span className={cn("block text-sm", active && "font-medium")}>{s.label}</span>
										<span className="mt-0.5 block text-xs text-fg-subtle">{s.hint}</span>
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			</dialog>
		</div>
	);
}
