"use client";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface TabItem {
	id: string;
	label: string;
	icon?: LucideIcon;
}

/** Roving tablist. Arrow keys move between tabs, as the WAI-ARIA pattern expects. */
export function Tabs({
	items,
	active,
	onChange,
	className,
}: {
	items: readonly TabItem[];
	active: string;
	onChange: (id: string) => void;
	className?: string;
}) {
	const move = (delta: number) => {
		const i = items.findIndex((t) => t.id === active);
		const next = items[(i + delta + items.length) % items.length];
		if (next) onChange(next.id);
	};

	return (
		<div
			role="tablist"
			aria-label="System sections"
			onKeyDown={(e) => {
				if (e.key === "ArrowRight") {
					e.preventDefault();
					move(1);
				}
				if (e.key === "ArrowLeft") {
					e.preventDefault();
					move(-1);
				}
			}}
			className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}
		>
			{items.map((t) => {
				const on = t.id === active;
				const Icon = t.icon;
				return (
					<button
						key={t.id}
						type="button"
						role="tab"
						id={`tab-${t.id}`}
						aria-selected={on}
						aria-controls={`panel-${t.id}`}
						tabIndex={on ? 0 : -1}
						onClick={() => onChange(t.id)}
						className={cn(
							"-mb-px flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-sm",
							"transition-colors",
							on
								? "border-accent font-medium text-fg"
								: "border-transparent text-fg-muted hover:border-border-strong hover:text-fg",
						)}
					>
						{Icon && <Icon className="size-4 shrink-0" aria-hidden />}
						{t.label}
					</button>
				);
			})}
		</div>
	);
}

export function TabPanel({ id, active, children }: { id: string; active: string; children: React.ReactNode }) {
	if (id !== active) return null;
	return (
		// tabIndex={0} is REQUIRED here, not accidental: the WAI-ARIA authoring
		// practices make a tabpanel focusable so keyboard users can reach panel
		// content that contains no focusable elements of its own.
		// biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA requires a focusable tabpanel
		<div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className="outline-none">
			{children}
		</div>
	);
}
