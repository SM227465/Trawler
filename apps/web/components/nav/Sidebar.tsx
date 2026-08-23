"use client";
import { PanelLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { SECTIONS } from "./sections";

const STORAGE_KEY = "ct-sidebar-collapsed";

/**
 * Sidebar on desktop, horizontal scroller on mobile.
 *
 * The collapse control sits at the TOP of the rail as an icon button — the
 * ChatGPT/Gemini placement — rather than occupying a nav row of its own. It
 * stays in the same spot in both states so it never moves out from under the
 * cursor.
 */
export function Sidebar() {
	const pathname = usePathname();
	const [collapsed, setCollapsed] = useState(false);
	const [ready, setReady] = useState(false);

	// Read after mount: the server cannot know the preference, and rendering the
	// wrong width first would flash.
	useEffect(() => {
		try {
			setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
		} catch {
			/* private mode — keep the default */
		}
		setReady(true);
	}, []);

	const toggle = () =>
		setCollapsed((prev) => {
			const next = !prev;
			try {
				localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
			} catch {
				/* ignore */
			}
			return next;
		});

	const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

	return (
		<nav
			aria-label="Sections"
			className={cn(
				"lg:shrink-0 lg:transition-[width] lg:duration-200",
				collapsed ? "lg:w-14" : "lg:w-52",
				!ready && "lg:transition-none",
			)}
		>
			<div className="lg:sticky lg:top-20">
				{/* Rail header — desktop only; on mobile the links are the whole nav. */}
				<div className={cn("mb-1 hidden lg:flex", collapsed ? "justify-center" : "justify-end")}>
					<button
						type="button"
						onClick={toggle}
						aria-expanded={!collapsed}
						aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
						title={collapsed ? "Open sidebar" : "Close sidebar"}
						className={cn(
							"grid size-8 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)]",
							"text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg",
						)}
					>
						<PanelLeft className="size-4" aria-hidden />
					</button>
				</div>

				<ul
					className={cn(
						"flex gap-1 overflow-x-auto border-b border-border pb-2",
						"lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0",
					)}
				>
					{SECTIONS.map((s) => {
						const active = isActive(s.href);
						const Icon = s.icon;
						return (
							<li key={s.href} className="shrink-0 lg:shrink">
								<Link
									href={s.href}
									aria-current={active ? "page" : undefined}
									title={collapsed ? s.label : s.hint}
									className={cn(
										"flex items-center gap-2.5 rounded-[var(--ct-radius-sm)] px-3 py-2 text-sm transition-colors",
										collapsed && "lg:justify-center lg:px-0",
										active
											? "bg-accent-soft font-medium text-accent"
											: "text-fg-muted hover:bg-surface-2 hover:text-fg",
									)}
								>
									<Icon className="size-4 shrink-0" aria-hidden />
									<span className={cn(collapsed && "lg:sr-only")}>{s.label}</span>
								</Link>
							</li>
						);
					})}
				</ul>
			</div>
		</nav>
	);
}
