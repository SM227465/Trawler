"use client";
import { X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Transient confirmation, so an action does not have to be verified on another
 * page.
 *
 * Deliberately small: no queueing policy, no positions, no variants beyond the
 * two tones anything here actually needs. A toast is a receipt — the durable
 * record of every transfer already lives on the Storage page, and this only has
 * to say "that worked" or "that did not" without stealing the pointer.
 */

export type ToastTone = "info" | "error";

interface ToastOptions {
	tone?: ToastTone;
	/** One optional way to act on it — usually "go and look at the thing". */
	action?: { label: string; onClick: () => void };
	/** Errors stay until dismissed; they are the ones worth reading twice. */
	durationMs?: number;
}

interface ToastItem extends ToastOptions {
	id: number;
	message: string;
}

const ToastContext = createContext<((message: string, options?: ToastOptions) => void) | null>(null);

export function useToast() {
	const ctx = useContext(ToastContext);
	if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
	return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
	const [items, setItems] = useState<ToastItem[]>([]);
	const nextId = useRef(1);

	const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

	const toast = useCallback((message: string, options: ToastOptions = {}) => {
		setItems((list) => {
			const item = { id: nextId.current++, message, ...options };
			// Three is enough to show a burst of queued uploads without becoming a
			// wall that covers the thing you just clicked.
			return [...list, item].slice(-3);
		});
	}, []);

	const value = useMemo(() => toast, [toast]);

	return (
		<ToastContext.Provider value={value}>
			{children}
			{/* aria-live on the container, not the toast: a region that appears at
			    the same moment its content does is announced inconsistently. */}
			<div
				aria-live="polite"
				aria-atomic="false"
				className={cn(
					"pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-center gap-2",
					"sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end",
				)}
			>
				{items.map((t) => (
					<Toast key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
				))}
			</div>
		</ToastContext.Provider>
	);
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
	const { tone = "info", durationMs = tone === "error" ? 0 : 5000 } = item;

	useEffect(() => {
		if (!durationMs) return;
		const timer = setTimeout(onDismiss, durationMs);
		return () => clearTimeout(timer);
	}, [durationMs, onDismiss]);

	return (
		<div
			role={tone === "error" ? "alert" : "status"}
			className={cn(
				"pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[var(--ct-radius)] border px-3.5 py-3",
				"bg-surface shadow-[var(--ct-shadow-lg)]",
				tone === "error" ? "border-status-errored/40" : "border-border",
			)}
		>
			<p className={cn("min-w-0 flex-1 text-sm", tone === "error" ? "text-status-errored" : "text-fg")}>
				{item.message}
			</p>

			{item.action && (
				<button
					type="button"
					onClick={() => {
						item.action?.onClick();
						onDismiss();
					}}
					className="shrink-0 cursor-pointer text-sm font-medium text-accent hover:underline"
				>
					{item.action.label}
				</button>
			)}

			<button
				type="button"
				onClick={onDismiss}
				aria-label="Dismiss"
				className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-fg-subtle hover:text-fg"
			>
				<X className="size-3.5" aria-hidden />
			</button>
		</div>
	);
}
