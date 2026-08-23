"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { api, type TransferSettings as Settings } from "@/lib/api";
import { cn } from "@/lib/cn";

const KB = 1024;
const MB = 1024 * 1024;

type Unit = "KB" | "MB";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-start sm:gap-6">
			<div className="sm:w-64 sm:shrink-0">
				<p className="text-sm text-fg">{label}</p>
				{hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
			</div>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

function NumberInput({
	value,
	onChange,
	suffix,
	min = 0,
	step = 1,
	disabled,
	width = "w-28",
}: {
	value: number;
	onChange: (n: number) => void;
	suffix?: string;
	min?: number;
	step?: number;
	disabled?: boolean;
	width?: string;
}) {
	return (
		<span className={cn("flex items-center gap-2", disabled && "opacity-50")}>
			<input
				type="number"
				inputMode="decimal"
				min={min}
				step={step}
				disabled={disabled}
				value={Number.isFinite(value) ? value : 0}
				onChange={(e) => onChange(Number(e.target.value))}
				className={cn(
					"tabular h-9 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2.5",
					"text-sm text-fg outline-none transition-colors focus:border-accent disabled:cursor-not-allowed",
					width,
				)}
			/>
			{suffix && <span className="text-xs text-fg-subtle">{suffix}</span>}
		</span>
	);
}

/**
 * Speed limits are stored as bytes/sec but read naturally in two different
 * ranges: upload caps on a metered box are tens to hundreds of KB/s, download
 * caps are whole MB/s. One fixed unit makes one of those awkward, so the unit
 * is the user's choice and only affects display.
 */
function SpeedInput({ bps, onChange, disabled }: { bps: number; onChange: (bps: number) => void; disabled?: boolean }) {
	// Seeded from the incoming value, then owned by the user — re-deriving it on
	// every render would yank the unit out from under them as they type.
	const [unit, setUnit] = useState<Unit>(() => (bps > 0 && bps < MB ? "KB" : "MB"));

	const factor = unit === "KB" ? KB : MB;
	// KB/s is always whole; MB/s keeps one decimal so 0.5 MB/s stays expressible.
	const shown = unit === "KB" ? Math.round(bps / KB) : Math.round((bps / MB) * 10) / 10;

	return (
		<span className="flex items-center gap-2">
			<NumberInput
				value={shown}
				// Math.round matters: 0.1 * 1048576 is 104857.6, and the API takes
				// an integer number of bytes. Without it every fractional MB/s 400s.
				onChange={(n) => onChange(Math.max(0, Math.round(n * factor)))}
				step={unit === "KB" ? 50 : 0.1}
				disabled={disabled}
				width="w-24"
			/>
			<span
				className={cn(
					"inline-flex overflow-hidden rounded-[var(--ct-radius-sm)] border border-border",
					disabled && "pointer-events-none opacity-50",
				)}
			>
				{(["KB", "MB"] as const).map((u) => (
					<button
						key={u}
						type="button"
						aria-pressed={unit === u}
						onClick={() => setUnit(u)}
						className={cn(
							"h-9 cursor-pointer px-2.5 text-xs transition-colors",
							unit === u ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:text-fg",
						)}
					>
						{u}/s
					</button>
				))}
			</span>
		</span>
	);
}

export function TransferSettings() {
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ["transfer-settings"], queryFn: api.transferSettings });
	const [draft, setDraft] = useState<Settings | null>(null);

	useEffect(() => {
		if (data) setDraft(data);
	}, [data]);

	const save = useMutation({
		mutationFn: (patch: Partial<Settings>) => api.updateTransferSettings(patch),
		onSuccess: (fresh) => {
			qc.setQueryData(["transfer-settings"], fresh);
			setDraft(fresh);
		},
	});

	if (!draft) return <p className="text-sm text-fg-muted">Loading…</p>;

	const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
	const dirty = data ? JSON.stringify(draft) !== JSON.stringify(data) : false;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-2.5 rounded-[var(--ct-radius)] border border-status-paused/40 bg-status-paused-soft p-3">
				<ShieldAlert className="mt-px size-4 shrink-0 text-status-paused" aria-hidden />
				<p className="text-xs text-fg">
					Oracle&apos;s free tier allows <strong>10 TB of outbound traffic a month</strong>, and seeding counts toward
					it. An uncapped box can exhaust that in days. A share-ratio limit is the effective control — a speed cap only
					slows how fast you get there.
				</p>
			</div>

			<section className="rounded-[var(--ct-radius)] border border-border bg-surface px-4">
				<Row label="Download limit" hint="0 means unlimited.">
					<SpeedInput bps={draft.dlLimitBps} onChange={(n) => set("dlLimitBps", n)} />
				</Row>

				<Row label="Upload limit" hint="This is the one that spends your egress allowance.">
					<SpeedInput bps={draft.upLimitBps} onChange={(n) => set("upLimitBps", n)} />
				</Row>

				<Row label="Stop seeding at ratio" hint="Uploaded ÷ downloaded. The strongest egress guard.">
					<div className="flex flex-col gap-2">
						<Checkbox
							label="Limit share ratio"
							checked={draft.maxRatioEnabled}
							onChange={(e) => set("maxRatioEnabled", e.target.checked)}
						/>
						<NumberInput
							value={draft.maxRatio < 0 ? 2 : draft.maxRatio}
							onChange={(n) => set("maxRatio", n)}
							suffix="× ratio"
							step={0.5}
							disabled={!draft.maxRatioEnabled}
						/>
					</div>
				</Row>

				<Row label="Stop seeding after" hint="A time cap, in addition to the ratio.">
					<div className="flex flex-col gap-2">
						<Checkbox
							label="Limit seeding time"
							checked={draft.maxSeedingTimeEnabled}
							onChange={(e) => set("maxSeedingTimeEnabled", e.target.checked)}
						/>
						<NumberInput
							value={draft.maxSeedingMinutes < 0 ? 1440 : draft.maxSeedingMinutes}
							onChange={(n) => set("maxSeedingMinutes", n)}
							suffix="minutes"
							step={60}
							disabled={!draft.maxSeedingTimeEnabled}
						/>
					</div>
				</Row>
			</section>

			<div className="flex items-center gap-3">
				<Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
					{save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
					Save limits
				</Button>
				{save.isSuccess && !dirty && (
					<span className="inline-flex items-center gap-1.5 text-xs text-status-completed">
						<Check className="size-3.5" aria-hidden />
						Applied to qBittorrent
					</span>
				)}
				{save.isError && <span className="text-xs text-status-errored">Could not save</span>}
			</div>
		</div>
	);
}
