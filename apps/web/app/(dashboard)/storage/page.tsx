"use client";
import { PageHeader } from "@/components/nav/PageHeader";
import { RemotesPanel } from "@/components/storage/RemotesPanel";
import { EgressPanel } from "@/components/torrent/EgressPanel";
import { StoragePanel } from "@/components/torrent/StoragePanel";

export default function StoragePage() {
	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader title="Storage" description="Disk and bandwidth. Nothing is deleted unless you ask for it." />
			<StoragePanel />
			<EgressPanel />
			<RemotesPanel />
		</div>
	);
}
