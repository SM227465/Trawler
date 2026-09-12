import { cn } from "@/lib/cn";

/**
 * Progress for a transfer that may not know its own size.
 *
 * Two states, and the difference is honest rather than cosmetic: a determinate
 * bar fills to a real fraction, an indeterminate one sweeps because the total
 * is genuinely unknown — a restore, or a source that was never sized. Both
 * move, because a multi-gigabyte copy can sit on the same percentage for
 * minutes and a still bar looks like a stalled one.
 *
 * The gradient and the travelling highlight live in globals.css next to the
 * rest of the app's animations, where prefers-reduced-motion is handled.
 */
export function TransferBar({ value, className }: { value: number | null; className?: string }) {
	const pct = value === null ? null : Math.max(0, Math.min(1, value)) * 100;

	return (
		<div
			className={cn(
				"relative h-1 w-full overflow-hidden rounded-full bg-surface-inset",
				pct === null && "ct-transfer-indeterminate",
				className,
			)}
			role="progressbar"
			aria-valuenow={pct === null ? undefined : Math.round(pct)}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuetext={pct === null ? "Transferring, size unknown" : undefined}
		>
			{pct !== null && (
				<div
					className="ct-transfer-fill relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out"
					style={{ width: `${pct}%` }}
				/>
			)}
		</div>
	);
}
