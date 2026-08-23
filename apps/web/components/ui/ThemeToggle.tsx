"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

const OPTIONS: Array<{ value: Theme; icon: typeof Sun; label: string }> = [
	{ value: "light", icon: Sun, label: "Light" },
	{ value: "system", icon: Monitor, label: "System" },
	{ value: "dark", icon: Moon, label: "Dark" },
];

export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>("system");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setTheme(readTheme());
		setMounted(true);
	}, []);

	const choose = (t: Theme) => {
		setTheme(t);
		applyTheme(t);
	};

	return (
		<div
			className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-inset p-0.5"
			role="radiogroup"
			aria-label="Colour theme"
		>
			{OPTIONS.map(({ value, icon: Icon, label }) => (
				// The parent carries role="radiogroup"; this is the standard ARIA
				// segmented-control pattern. `useSemanticElements` wants
				// <input type="radio">, which cannot be styled as a segmented
				// control and would need a visually-hidden input plus a label per
				// option to look identical.
				// biome-ignore lint/a11y/useSemanticElements: deliberate radiogroup/radio pattern
				<button
					key={value}
					type="button"
					role="radio"
					aria-checked={mounted && theme === value}
					aria-label={label}
					title={label}
					onClick={() => choose(value)}
					className={cn(
						"grid size-7 place-items-center rounded-full transition-colors duration-150 cursor-pointer",
						mounted && theme === value
							? "bg-surface text-fg shadow-[var(--ct-shadow)]"
							: "text-fg-subtle hover:text-fg",
					)}
				>
					<Icon className="size-3.5" aria-hidden />
				</button>
			))}
		</div>
	);
}
