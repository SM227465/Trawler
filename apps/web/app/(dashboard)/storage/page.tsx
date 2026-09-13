"use client";
import { PageHeader } from "@/components/nav/PageHeader";
import { EgressPanel } from "@/components/torrent/EgressPanel";
import { StoragePanel } from "@/components/torrent/StoragePanel";

/** This box: what it is holding and what it has sent. Remotes live under Cloud. */
export default function StoragePage() {
	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader title="Storage" description="Disk and bandwidth. Nothing is deleted unless you ask for it." />
			<StoragePanel />
			<EgressPanel />
		</div>
	);
}
