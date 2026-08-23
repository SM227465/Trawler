"use client";
import { AuditLog } from "@/components/activity/AuditLog";
import { PageHeader } from "@/components/nav/PageHeader";

export default function ActivityPage() {
	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader
				title="Activity"
				description="Sign-ins and every change made to this box. Read-only, and kept for 30 days."
			/>
			<AuditLog />
		</div>
	);
}
