"use client";
import { Columns3, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { cn } from "@/lib/cn";
import { HIDEABLE } from "./useColumns";

export function ColumnMenu({
	hidden,
	onToggle,
	onReset,
}: {
	hidden: Set<string>;
	onToggle: (col: string) => void;
	onReset: () => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	// Close on outside click and on Escape — a popover that only closes by
	// clicking its own button is a trap for keyboard users.
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div ref={ref} className="relative hidden lg:block">
			<Button
				size="sm"
				variant="subtle"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-haspopup="true"
				title="Choose columns"
			>
				<Columns3 className="size-3.5" aria-hidden />
				Columns
				{hidden.size > 0 && <span className="tabular text-fg-subtle">{HIDEABLE.length - hidden.size}</span>}
			</Button>

			{open && (
				<div
					className={cn(
						"absolute right-0 z-20 mt-1 w-52 rounded-[var(--ct-radius)] border border-border",
						"bg-surface p-2 shadow-[var(--ct-shadow-lg)]",
					)}
				>
					<ul className="space-y-1">
						{HIDEABLE.map((col) => (
							<li key={col} className="rounded-[var(--ct-radius-sm)] px-1.5 py-1 hover:bg-surface-2">
								<Checkbox label={col} checked={!hidden.has(col)} onChange={() => onToggle(col)} />
							</li>
						))}
					</ul>
					<button
						type="button"
						onClick={onReset}
						className="mt-2 flex w-full cursor-pointer items-center gap-1.5 rounded-[var(--ct-radius-sm)] px-1.5 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
					>
						<RotateCcw className="size-3" aria-hidden />
						Show all
					</button>
				</div>
			)}
		</div>
	);
}
