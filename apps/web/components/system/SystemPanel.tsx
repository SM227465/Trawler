"use client";
import { Cpu, Gauge, HardDrive, MemoryStick, Network, Server } from "lucide-react";
import { type TabItem, TabPanel, Tabs } from "@/components/ui/Tabs";
import type { SystemStatus } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { CoreGrid } from "./CoreGrid";
import { Sparkline } from "./Sparkline";

const pct = (v: number) => `${v.toFixed(0)}%`;
const rate = (v: number) => `${formatBytes(v)}/s`;

const uptime = (s: number) => {
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export const SYSTEM_TABS: readonly TabItem[] = [
	{ id: "processor", label: "Processor", icon: Cpu },
	{ id: "memory", label: "Memory", icon: MemoryStick },
	{ id: "network", label: "Network", icon: Network },
	{ id: "torrent", label: "Torrent traffic", icon: Gauge },
	{ id: "storage", label: "Storage", icon: HardDrive },
	{ id: "services", label: "Services", icon: Server },
] as const;

/** Hero number + chart + properties — the shape every panel shares. */
function Panel({
	hero,
	sub,
	children,
	properties,
}: {
	hero: string;
	sub?: string;
	children?: React.ReactNode;
	properties?: Array<[string, string]>;
}) {
	return (
		<div className="flex flex-col gap-4 pt-4">
			<div>
				<p className="tabular text-3xl font-semibold text-fg">{hero}</p>
				{sub && <p className="mt-1 text-sm text-fg-muted">{sub}</p>}
			</div>

			{children}

			{properties && properties.length > 0 && (
				<dl className="divide-y divide-border overflow-hidden rounded-[var(--ct-radius)] border border-border bg-surface">
					{properties.map(([k, v]) => (
						<div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
							<dt className="text-sm text-fg-muted">{k}</dt>
							<dd className="tabular truncate text-sm text-fg" title={v}>
								{v}
							</dd>
						</div>
					))}
				</dl>
			)}
		</div>
	);
}

function Legend({ items }: { items: Array<{ label: string; tone: "viz-1" | "viz-2" | "viz-3" | "viz-4" }> }) {
	const dot = { "viz-1": "bg-viz-1", "viz-2": "bg-viz-2", "viz-3": "bg-viz-3", "viz-4": "bg-viz-4" };
	return (
		<ul className="flex flex-wrap gap-4 text-xs">
			{items.map((i) => (
				<li key={i.label} className="flex items-center gap-1.5 text-fg-muted">
					<span className={cn("size-2 rounded-full", dot[i.tone])} aria-hidden />
					{i.label}
				</li>
			))}
		</ul>
	);
}

export function SystemPanel({ data, tab, onTab }: { data: SystemStatus; tab: string; onTab: (id: string) => void }) {
	const { host, memory, disk, process: proc, services, history, latest } = data;

	const cpuSeries = history.map((s) => s.cpuPct);
	const memSeries = history.map((s) => (s.memTotalBytes ? (s.memUsedBytes / s.memTotalBytes) * 100 : 0));
	const memPct = memory.totalBytes ? (memory.usedBytes / memory.totalBytes) * 100 : 0;
	const cores = latest?.perCorePct ?? [];

	return (
		<div>
			<Tabs items={SYSTEM_TABS} active={tab} onChange={onTab} />

			<TabPanel id="processor" active={tab}>
				<Panel
					hero={pct(latest?.cpuPct ?? 0)}
					sub={host.cpuModel}
					properties={[
						["Logical cores", String(host.cpuCount)],
						["Load (1m)", host.load.one.toFixed(2)],
						["Load (5m)", host.load.five.toFixed(2)],
						["Load (15m)", host.load.fifteen.toFixed(2)],
						["Per core", pct(host.load.perCore * 100)],
						["Architecture", `${host.platform}/${host.arch}`],
					]}
				>
					<Sparkline series={[{ label: "CPU", values: cpuSeries, tone: "viz-1" }]} max={100} format={pct} />
					{cores.length > 0 && <CoreGrid cores={cores} />}
				</Panel>
			</TabPanel>

			<TabPanel id="memory" active={tab}>
				<Panel
					hero={`${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`}
					sub={`${pct(memPct)} used · ${memory.source === "cgroup" ? "container limit" : "host total"}`}
					properties={[
						["Used", formatBytes(memory.usedBytes)],
						["Free", formatBytes(memory.freeBytes)],
						["Total", formatBytes(memory.totalBytes)],
						["Reported by", memory.source === "cgroup" ? "cgroup v2 (container limit)" : "host"],
						["API process RSS", formatBytes(proc.rssBytes)],
					]}
				>
					<Sparkline series={[{ label: "Memory", values: memSeries, tone: "viz-2" }]} max={100} format={pct} />
				</Panel>
			</TabPanel>

			<TabPanel id="network" active={tab}>
				<Panel
					hero={rate(latest?.netRxBps ?? 0)}
					sub={`receiving · sending ${rate(latest?.netTxBps ?? 0)}`}
					properties={[
						["Receiving", rate(latest?.netRxBps ?? 0)],
						["Sending", rate(latest?.netTxBps ?? 0)],
						["Scope", "container interfaces, loopback excluded"],
					]}
				>
					{/* Two series, ONE shared scale — never a second y-axis. */}
					<Sparkline
						series={[
							{ label: "Receiving", values: history.map((s) => s.netRxBps), tone: "viz-3" },
							{ label: "Sending", values: history.map((s) => s.netTxBps), tone: "viz-4" },
						]}
						format={rate}
					/>
					<Legend
						items={[
							{ label: "Receiving", tone: "viz-3" },
							{ label: "Sending", tone: "viz-4" },
						]}
					/>
				</Panel>
			</TabPanel>

			<TabPanel id="torrent" active={tab}>
				<Panel
					hero={rate(latest?.dlBps ?? 0)}
					sub={`download · upload ${rate(latest?.upBps ?? 0)}`}
					properties={[
						["Download", rate(latest?.dlBps ?? 0)],
						["Upload", rate(latest?.upBps ?? 0)],
						["Source", "qBittorrent session counters"],
					]}
				>
					<Sparkline
						series={[
							{ label: "Download", values: history.map((s) => s.dlBps), tone: "viz-1" },
							{ label: "Upload", values: history.map((s) => s.upBps), tone: "viz-2" },
						]}
						format={rate}
					/>
					<Legend
						items={[
							{ label: "Download", tone: "viz-1" },
							{ label: "Upload", tone: "viz-2" },
						]}
					/>
				</Panel>
			</TabPanel>

			<TabPanel id="storage" active={tab}>
				<Panel
					hero={disk ? `${formatBytes(disk.freeBytes)} free` : "unavailable"}
					sub={disk ? `${disk.usedPct.toFixed(0)}% of ${formatBytes(disk.totalBytes)} used` : undefined}
					properties={
						disk
							? [
									["Used", formatBytes(disk.usedBytes)],
									["Free", formatBytes(disk.freeBytes)],
									["Total", formatBytes(disk.totalBytes)],
								]
							: undefined
					}
				>
					{disk && (
						<div className="h-2 overflow-hidden rounded-full bg-surface-inset">
							<div
								className={cn("h-full rounded-full", disk.usedPct >= 90 ? "bg-status-paused" : "bg-viz-4")}
								style={{ width: `${Math.min(100, disk.usedPct)}%` }}
							/>
						</div>
					)}
				</Panel>
			</TabPanel>

			<TabPanel id="services" active={tab}>
				<Panel
					hero={uptime(host.uptimeSeconds)}
					sub={`host uptime · api up ${uptime(proc.uptimeSeconds)}`}
					properties={[
						["qBittorrent", services.qbittorrent.reachable ? (services.qbittorrent.version ?? "up") : "unreachable"],
						["Node", proc.nodeVersion],
						["Host", `${host.platform}/${host.arch}`],
						["Sample interval", `${data.sampleIntervalMs} ms`],
						["History window", `${history.length} samples`],
					]}
				/>
			</TabPanel>
		</div>
	);
}
