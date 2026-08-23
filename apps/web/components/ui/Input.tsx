"use client";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			className={cn(
				"w-full h-10 px-3 rounded-[var(--ct-radius-sm)]",
				"bg-surface-inset text-fg placeholder:text-fg-subtle",
				"border border-border focus:border-accent",
				"outline-none transition-colors duration-150",
				className,
			)}
			{...rest}
		/>
	);
}
