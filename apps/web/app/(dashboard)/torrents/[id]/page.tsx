"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIcon, ArrowLeft, FileText, Grid3x3, Info, Pin, PinOff, Radio, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { DetailContent } from "@/components/detail/DetailContent";
import { DetailGeneral } from "@/components/detail/DetailGeneral";
import { DetailPeers } from "@/components/detail/DetailPeers";
import { DetailSpeed } from "@/components/detail/DetailSpeed";
import { DetailTrackers } from "@/components/detail/DetailTrackers";
import { PieceMap } from "@/components/detail/PieceMap";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { type TabItem, TabPanel, Tabs } from "@/components/ui/Tabs";
import { api, type Torrent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatPercent } from "@/lib/format";
import { useSpeedHistory } from "@/lib/useSpeedHistory";
import { useTorrentDetail } from "@/lib/useTorrentDetail";
import { torrentKey } from "@/lib/useTorrentStream";
import { useUrlState } from "@/lib/useUrlState";

const TABS: readonly TabItem[] = [
	{ id: "general", label: "General", icon: Info },
	{ id: "trackers", label: "Trackers", icon: Radio },
	{ id: "peers", label: "Peers", icon: Users },
	{ id: "content", label: "Content", icon: FileText },
	{ id: "pieces", label: "Pieces", icon: Grid3x3 },
	{ id: "speed", label: "Speed", icon: ActivityIcon },
] as const;

function DetailView() {
	const { id } = useParams<{ id: string }>();
	const [url, setUrl] = useUrlState({ tab: TABS[0].id });
	const active = TABS.some((t) => t.id === url.tab) ? url.tab : TABS[0].id;

	const {
		data: torrent,
		isLoading,
		isError,
	} = useQuery<Torrent>({
		queryKey: ["torrent", id],
		queryFn: () => api.getTorrent(id),
		// A bad id is a 404, not a transient failure — retrying just delays the
		// message and leaves the page sitting on "Loading…" indefinitely.
		retry: false,
	});

	// Pinning moved here from the transfer list: it is a rare, deliberate act —
	// "never clean this up" — and it was costing every row in the table a button
	// of width that the name needed more.
	const qc = useQueryClient();
	const pin = useMutation({
		mutationFn: (next: boolean) => api.action(id, next ? "pin" : "unpin"),
		// The list reads the same per-torrent cache entry, so writing it here is
		// what puts the pin beside the name back in the table — no refetch.
		onSuccess: (_r, next) => qc.setQueryData<Torrent>(torrentKey(id), (p) => (p ? { ...p, pinned: next } : p)),
	});

	// Opening this hook starts the server-side pollers for this torrent;
	// navigating away closes the stream and stops them.
	const detail = useTorrentDetail(id);
	const speedHistory = useSpeedHistory(id);

	if (isLoading) return <p className="text-sm text-fg-muted">Loading…</p>;

	if (isError || !torrent) {
		return (
			<div className="flex flex-col gap-3">
				<Link href="/" className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
					<ArrowLeft className="size-3.5" aria-hidden />
					Transfers
				</Link>
				<div className="rounded-[var(--ct-radius)] border border-border bg-surface p-10 text-center">
					<p className="text-sm font-medium text-fg">Torrent not found</p>
					<p className="mt-1 text-xs text-fg-muted">It may have been removed, or cleaned up to free disk space.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<div>
				<Link
					href="/"
					className="inline-flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
				>
					<ArrowLeft className="size-3.5" aria-hidden />
					Transfers
				</Link>

				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
					<h2 className="min-w-0 break-words text-base font-semibold text-fg">{torrent.name}</h2>
					<StatusChip status={torrent.status} detail={torrent.qbtState} />
					<span className="tabular text-xs text-fg-subtle">
						{formatPercent(torrent.progress)} of {formatBytes(torrent.sizeBytes)}
					</span>
					<Button
						size="sm"
						variant={torrent.pinned ? "subtle" : "ghost"}
						aria-pressed={torrent.pinned}
						disabled={pin.isPending}
						onClick={() => pin.mutate(!torrent.pinned)}
						title={
							torrent.pinned
								? "Pinned — cleanup will never remove this. Click to unpin."
								: "Pin to protect this from cleanup"
						}
						className={cn("ml-auto", torrent.pinned && "text-accent")}
					>
						{torrent.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
						{torrent.pinned ? "Pinned" : "Pin"}
					</Button>

					<span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
						<span
							className={cn(
								"size-1.5 rounded-full",
								detail.connected ? "bg-status-completed" : "animate-pulse bg-status-paused",
							)}
							aria-hidden
						/>
						{detail.connected ? "Live" : "Connecting…"}
					</span>
				</div>
			</div>

			<Tabs items={TABS} active={active} onChange={(tab) => setUrl({ tab })} />

			<TabPanel id="general" active={active}>
				<div className="pt-4">
					<DetailGeneral torrent={torrent} props={detail.properties} />
				</div>
			</TabPanel>
			<TabPanel id="trackers" active={active}>
				<div className="pt-4">
					<DetailTrackers trackers={detail.trackers} />
				</div>
			</TabPanel>
			<TabPanel id="peers" active={active}>
				<div className="pt-4">
					<DetailPeers peers={detail.peers} total={detail.peerTotal} capped={detail.peersCapped} />
				</div>
			</TabPanel>
			<TabPanel id="content" active={active}>
				<div className="pt-4">
					<DetailContent torrentId={id} />
				</div>
			</TabPanel>
			<TabPanel id="speed" active={active}>
				<div className="pt-4">
					<DetailSpeed torrent={torrent} props={detail.properties} history={speedHistory} />
				</div>
			</TabPanel>
			<TabPanel id="pieces" active={active}>
				<div className="pt-4">
					{detail.pieces ? (
						<PieceMap data={detail.pieces} />
					) : (
						<p className="rounded-[var(--ct-radius)] border border-border bg-surface p-8 text-center text-sm text-fg-muted">
							Waiting for piece data…
						</p>
					)}
				</div>
			</TabPanel>
		</div>
	);
}

export default function TorrentDetailPage() {
	return (
		<Suspense fallback={<p className="text-sm text-fg-muted">Loading…</p>}>
			<DetailView />
		</Suspense>
	);
}
