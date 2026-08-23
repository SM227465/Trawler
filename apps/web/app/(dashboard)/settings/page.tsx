"use client";
import { PageHeader } from "@/components/nav/PageHeader";
import { TransferSettings } from "@/components/settings/TransferSettings";

export default function SettingsPage() {
	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader title="Settings" description="Speed and seeding limits. These protect the Oracle egress allowance." />
			<TransferSettings />
		</div>
	);
}
