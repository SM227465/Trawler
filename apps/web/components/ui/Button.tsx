"use client";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "subtle" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const VARIANTS: Record<Variant, string> = {
	primary: "bg-accent text-accent-fg hover:bg-accent-hover",
	subtle: "bg-surface-2 text-fg hover:bg-surface-inset border border-border",
	ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
	danger: "bg-danger text-danger-fg hover:opacity-90",
};

const SIZES: Record<Size, string> = {
	sm: "h-8 px-3 text-xs gap-1.5",
	md: "h-10 px-4 text-sm gap-2",
	icon: "h-8 w-8 justify-center",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
	{ variant = "subtle", size = "md", className, ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			className={cn(
				"inline-flex items-center rounded-[var(--ct-radius-sm)] font-medium",
				"transition-colors duration-150 cursor-pointer",
				"disabled:opacity-50 disabled:pointer-events-none",
				VARIANTS[variant],
				SIZES[size],
				className,
			)}
			{...rest}
		/>
	);
});
