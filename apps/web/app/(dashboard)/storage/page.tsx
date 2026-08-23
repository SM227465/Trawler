"use client";
import { PageHeader } from "@/components/nav/PageHeader";
import { StoragePanel } from "@/components/torrent/StoragePanel";

export default function StoragePage() {
	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader
				title="Storage"
				description="Disk usage and cleanup. Nothing is deleted unless you ask for it."
			/>
			<StoragePanel />
		</div>
	);
}
