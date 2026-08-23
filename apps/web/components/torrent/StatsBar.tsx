"use client";
import { ArrowDown, ArrowUp, HardDrive, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes, formatSpeed } from "@/lib/format";
import { useCacheOnly } from "@/lib/useCacheOnly";
import { type QbtStats, STATS_KEY } from "@/lib/useTorrentStream";

function Stat({
	icon: Icon,
	label,
	value,
	tone,
	title,
}: {
	icon: typeof ArrowDown;
	label: string;
	value: string;
	tone?: string;
	title?: string;
}) {
	return (
		<div className="flex items-center gap-2 min-w-0" title={title}>
			<Icon className={cn("size-4 shrink-0", tone ?? "text-fg-subtle")} aria-hidden />
			<div className="min-w-0">
				<div className="text-[0.6875rem] leading-none text-fg-subtle">{label}</div>
				<div className={cn("tabular mt-1 text-sm leading-none font-medium truncate", tone ?? "text-fg")}>{value}</div>
			</div>
		</div>
	);
}

/** Stable identity for the cache-only read below. */
const EMPTY_STATS: QbtStats = {};

export function StatsBar() {
	const data = useCacheOnly<QbtStats>(STATS_KEY, EMPTY_STATS);
	const s = data ?? {};

	const conn = s.connection_status ?? "unknown";
	// "firewalled" means no inbound peers — on Oracle it means the torrent port
	// is not open in BOTH the Security List and iptables. Best single
	// diagnostic for "why is this slow", so it gets a colour, not a footnote.
	const firewalled = conn === "firewalled";
	const disconnected = conn === "disconnected";

	return (
		<div
			className={cn(
				"grid gap-4 rounded-[var(--ct-radius)] border border-border bg-surface p-3 sm:p-4",
				"grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
			)}
		>
			<Stat icon={ArrowDown} label="Download" value={formatSpeed(s.dl_info_speed)} tone="text-chart-dl" />
			<Stat icon={ArrowUp} label="Upload" value={formatSpeed(s.up_info_speed)} tone="text-chart-ul" />
			<Stat icon={ArrowDown} label="Session ↓" value={formatBytes(s.dl_info_data)} />
			<Stat icon={ArrowUp} label="Session ↑" value={formatBytes(s.up_info_data)} />
			<Stat icon={HardDrive} label="Free disk" value={formatBytes(s.free_space_on_disk)} />
			<Stat
				icon={firewalled ? ShieldAlert : disconnected ? WifiOff : Wifi}
				label="Network"
				value={firewalled ? "Firewalled" : disconnected ? "Disconnected" : `DHT ${s.dht_nodes ?? 0}`}
				tone={firewalled ? "text-warning" : disconnected ? "text-status-errored" : "text-status-completed"}
				title={
					firewalled
						? "No inbound connections. Open the torrent port in both the cloud firewall and the instance's iptables."
						: undefined
				}
			/>
		</div>
	);
}
