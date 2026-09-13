"use client";
import { PageHeader } from "@/components/nav/PageHeader";
import { RemotesPanel } from "@/components/storage/RemotesPanel";
import { TransferHistory } from "@/components/storage/TransferHistory";
import { UploadsPanel } from "@/components/storage/UploadsPanel";

/**
 * Everywhere that is not this box, and everything moving there.
 *
 * Connections first because nothing else on the page means anything without
 * one, then what is moving now, then what has already moved. Disk and
 * bandwidth stayed behind on Storage: that page is about the box itself.
 */
export default function CloudPage() {
	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader
				title="Cloud"
				description="External storage and the transfers to it. Nothing is uploaded until you ask for it."
			/>
			<RemotesPanel />
			<UploadsPanel />
			<TransferHistory />
		</div>
	);
}
