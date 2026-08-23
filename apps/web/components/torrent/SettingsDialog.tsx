"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { api, type StorageStatus } from "@/lib/api";
import { cn } from "@/lib/cn";

type Settings = StorageStatus["settings"];

function Field({
	label,
	hint,
	suffix,
	value,
	onChange,
	min = 0,
	max,
	disabled,
}: {
	label: string;
	hint?: string;
	suffix?: string;
	value: number;
	onChange: (n: number) => void;
	min?: number;
	max?: number;
	disabled?: boolean;
}) {
	return (
		<label className={cn("block", disabled && "opacity-50")}>
			<span className="block text-sm text-fg">{label}</span>
			{hint && <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>}
			<span className="mt-1.5 flex items-center gap-2">
				<input
					type="number"
					inputMode="numeric"
					min={min}
					max={max}
					value={Number.isFinite(value) ? value : 0}
					disabled={disabled}
					onChange={(e) => onChange(Number(e.target.value))}
					className={cn(
						"tabular h-9 w-28 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2.5",
						"text-sm text-fg outline-none transition-colors focus:border-accent",
						"disabled:cursor-not-allowed",
					)}
				/>
				{suffix && <span className="text-xs text-fg-subtle">{suffix}</span>}
			</span>
		</label>
	);
}

export function SettingsDialog({
	open,
	onClose,
	settings,
}: {
	open: boolean;
	onClose: () => void;
	settings: Settings;
}) {
	const qc = useQueryClient();
	const [draft, setDraft] = useState<Settings>(settings);
	const [error, setError] = useState<string | null>(null);

	// Re-seed whenever the dialog opens so a cancelled edit never lingers.
	useEffect(() => {
		if (open) {
			setDraft(settings);
			setError(null);
		}
	}, [open, settings]);

	const save = useMutation({
		mutationFn: () => api.updateStorageSettings(draft),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["storage"] });
			onClose();
		},
		onError: (e) => setError(e instanceof Error ? e.message : "Could not save settings"),
	});

	const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));
	const watermarksInvalid = draft.lowWatermarkPct >= draft.highWatermarkPct;

	return (
		<Dialog open={open} onClose={onClose} title="Cleanup settings" description="How storage is reclaimed.">
			<div className="mt-5 space-y-5">
				<div>
					<Checkbox
						label="Delete idle torrents automatically"
						hint="Off by default. Leave it off and cleanup only ever happens when you press the button."
						checked={draft.enabled}
						onChange={(e) => set("enabled", e.target.checked)}
					/>
					{draft.enabled && !settings.enabled && (
						<p className="mt-2 flex items-start gap-2 rounded-[var(--ct-radius-sm)] border border-status-paused/40 bg-status-paused-soft p-2.5 text-xs text-fg">
							<TriangleAlert className="mt-px size-3.5 shrink-0 text-status-paused" aria-hidden />
							<span>
								Torrents will be deleted without asking, every 5 minutes, once they go idle past the TTL below.
								Pinned and shared torrents are still never touched.
							</span>
						</p>
					)}
				</div>

				<Field
					label="Idle time before cleanup"
					hint="How long a completed torrent may sit unused before it becomes a cleanup candidate."
					suffix="hours"
					min={1}
					max={8760}
					value={draft.ttlHours}
					onChange={(n) => set("ttlHours", n)}
				/>

				<Field
					label="Library budget"
					hint="Cap on total torrent size. 0 means no cap — the disk watermark governs instead."
					suffix="GB"
					min={0}
					value={Math.round(draft.budgetBytes / 1e9)}
					onChange={(n) => set("budgetBytes", Math.max(0, n) * 1e9)}
				/>

				<div className="grid grid-cols-2 gap-4">
					<Field
						label="Start cleanup at"
						suffix="% disk"
						min={1}
						max={99}
						value={draft.highWatermarkPct}
						onChange={(n) => set("highWatermarkPct", n)}
					/>
					<Field
						label="Clean down to"
						suffix="% disk"
						min={1}
						max={99}
						value={draft.lowWatermarkPct}
						onChange={(n) => set("lowWatermarkPct", n)}
					/>
				</div>

				{watermarksInvalid && (
					<p role="alert" className="text-xs text-status-errored">
						“Clean down to” must be below “start cleanup at”.
					</p>
				)}
				{error && (
					<p role="alert" className="text-xs text-status-errored">
						{error}
					</p>
				)}
			</div>

			<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button variant="subtle" onClick={onClose} disabled={save.isPending} className="justify-center">
					Cancel
				</Button>
				<Button
					variant="primary"
					onClick={() => save.mutate()}
					disabled={save.isPending || watermarksInvalid}
					className="justify-center"
				>
					{save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
					Save
				</Button>
			</div>
		</Dialog>
	);
}
