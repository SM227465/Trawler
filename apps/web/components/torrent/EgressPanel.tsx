"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";

/** Oracle's Always Free outbound allowance. Inbound is not metered at all. */
const ALLOWANCE = 10 * 1000 ** 4; // 10 TB, decimal — how providers bill

function daysLeftInMonth() {
	const now = new Date();
	const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

export function EgressPanel() {
	const { data } = useQuery({ queryKey: ["storage"], queryFn: api.storage, refetchInterval: 30_000 });
	const e = data?.egress;
	if (!e) return null;

	const used = e.monthToDateBytes;
	const pct = Math.min(100, (used / ALLOWANCE) * 100);

	// Straight-line projection from the month so far. Crude, but the question it
	// answers — "at this rate, do I finish the month inside the allowance?" — is
	// the only one worth asking mid-month.
	const now = new Date();
	const dayOfMonth = now.getDate();
	const daysInMonth = dayOfMonth + daysLeftInMonth() - 1;
	const projected = (used / dayOfMonth) * daysInMonth;
	const willExceed = projected > ALLOWANCE;

	const tone =
		e.level === "stop"
			? { bar: "bg-status-errored", text: "text-status-errored" }
			: e.level === "warn"
				? { bar: "bg-status-paused", text: "text-status-paused" }
				: { bar: "bg-status-completed", text: "text-fg" };

	return (
		<section className="rounded-[var(--ct-radius)] border border-border bg-surface p-4">
			<div className="flex flex-wrap items-center gap-2">
				<Gauge className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				<h2 className="text-sm font-medium text-fg">Bandwidth this month</h2>
				<span className={cn("tabular ml-auto text-sm font-semibold", tone.text)}>
					{formatBytes(used)} <span className="font-normal text-fg-subtle">of 10 TB</span>
				</span>
			</div>

			<div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-inset">
				<div
					className={cn("h-full rounded-full transition-[width] duration-500", tone.bar)}
					style={{ width: `${pct}%` }}
				/>
			</div>

			<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
				<div>
					<dt className="text-fg-subtle">Used</dt>
					<dd className="tabular mt-0.5 text-fg">{pct.toFixed(1)}%</dd>
				</div>
				<div>
					<dt className="text-fg-subtle">Days left</dt>
					<dd className="tabular mt-0.5 text-fg">{daysLeftInMonth()}</dd>
				</div>
				<div>
					<dt className="text-fg-subtle">At this rate</dt>
					<dd className={cn("tabular mt-0.5", willExceed ? "text-status-errored" : "text-fg")}>
						{formatBytes(projected)}
					</dd>
				</div>
				<div>
					<dt className="text-fg-subtle">Stops sharing at</dt>
					<dd className="tabular mt-0.5 text-fg">{formatBytes(e.hardStopBytes)}</dd>
				</div>
			</dl>

			{e.level === "stop" && (
				<p className="mt-3 rounded-[var(--ct-radius-sm)] bg-status-errored-soft px-3 py-2 text-xs text-fg">
					Share links are refusing downloads. Your own downloads still work — locking you out of your files to protect a
					quota would be the worse outcome.
				</p>
			)}
			{e.level === "warn" && (
				<p className="mt-3 rounded-[var(--ct-radius-sm)] bg-status-paused-soft px-3 py-2 text-xs text-fg">
					Past the soft alert. Share links keep working until {formatBytes(e.hardStopBytes)}, then stop.
				</p>
			)}
			{e.level === "ok" && willExceed && (
				<p className="mt-3 rounded-[var(--ct-radius-sm)] bg-status-paused-soft px-3 py-2 text-xs text-fg">
					On track to pass 10 TB before the month ends. A share-ratio limit in Settings is the effective control.
				</p>
			)}

			{/* Being explicit about what is and is not in this number. Getting this
			    wrong in the reassuring direction is how someone gets a bill. */}
			<div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-xs text-fg-subtle">
				<p className="flex items-start gap-1.5">
					<ArrowUp className="mt-0.5 size-3 shrink-0" aria-hidden />
					<span>
						<strong className="font-medium text-fg-muted">Counted:</strong> everything served over HTTPS — share links,
						your own downloads, streaming, the web app itself.
					</span>
				</p>
				<p className="flex items-start gap-1.5">
					<ArrowDown className="mt-0.5 size-3 shrink-0" aria-hidden />
					<span>
						<strong className="font-medium text-fg-muted">Not counted:</strong> downloading torrents. Inbound traffic is
						free and unmetered on Oracle.
					</span>
				</p>
				<p className="flex items-start gap-1.5">
					<ArrowUp className="mt-0.5 size-3 shrink-0 text-status-paused" aria-hidden />
					<span>
						<strong className="font-medium text-status-paused">Billed but not measured here:</strong> BitTorrent
						seeding. Those bytes leave on port 6881 without passing through Caddy, so this figure cannot see them — cap
						them with a share ratio and an upload limit in Settings.
					</span>
				</p>
			</div>
		</section>
	);
}
