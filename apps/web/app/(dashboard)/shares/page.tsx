"use client";
import { PageHeader } from "@/components/nav/PageHeader";
import { ShareList } from "@/components/share/ShareList";

export default function SharesPage() {
	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader title="Shares" description="Links you have handed out. Revoking one stops it immediately." />
			<ShareList />
		</div>
	);
}
