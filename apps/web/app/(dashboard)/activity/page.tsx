"use client";
import { KeyRound, Share2 } from "lucide-react";
import { useState } from "react";
import { AuditLog } from "@/components/activity/AuditLog";
import { ClearLogButton } from "@/components/activity/ClearLogButton";
import { ShareAccessFeed } from "@/components/activity/ShareAccessFeed";
import { PageHeader } from "@/components/nav/PageHeader";
import { Tabs } from "@/components/ui/Tabs";

/**
 * Two feeds, deliberately not merged. audit_log records what the OWNER did;
 * share_access_log records what strangers did with the links the owner handed
 * out. They answer different questions, have their own sequences, and unioning
 * them would mean giving up keyset pagination on both.
 */
const TABS = [
	{ id: "account", label: "Account & changes", icon: KeyRound },
	{ id: "shares", label: "Share access", icon: Share2 },
] as const;

export default function ActivityPage() {
	const [tab, setTab] = useState<string>("account");

	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader
				title="Activity"
				description="Sign-ins, changes to this box, and who used your share links. Read-only, kept for 30 days."
			/>
			<div className="flex flex-wrap items-center gap-3">
				<Tabs items={TABS} active={tab} onChange={setTab} className="min-w-0 flex-1" />
				<ClearLogButton
					target={tab === "account" ? "audit" : "shares"}
					label={tab === "account" ? "the activity log" : "share access history"}
				/>
			</div>
			{tab === "account" ? <AuditLog /> : <ShareAccessFeed />}
		</div>
	);
}
