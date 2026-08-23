"use client";
import { Check } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Checkbox({
	label,
	hint,
	className,
	...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
	return (
		<label className={cn("flex cursor-pointer items-start gap-2.5 select-none", className)}>
			<span className="relative mt-0.5 grid size-4 shrink-0 place-items-center">
				<input type="checkbox" className="peer sr-only" {...rest} />
				<span
					aria-hidden
					className={cn(
						"size-4 rounded-[0.25rem] border border-border-strong bg-surface-inset transition-colors",
						"peer-checked:border-accent peer-checked:bg-accent",
						"peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
					)}
				/>
				<Check
					aria-hidden
					className="pointer-events-none absolute size-3 text-accent-fg opacity-0 peer-checked:opacity-100"
				/>
			</span>
			<span className="min-w-0">
				<span className="block text-sm text-fg">{label}</span>
				{hint && <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>}
			</span>
		</label>
	);
}
