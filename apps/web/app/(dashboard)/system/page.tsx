"use client";
import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { PageHeader } from "@/components/nav/PageHeader";
import { SYSTEM_TABS, SystemPanel } from "@/components/system/SystemPanel";
import { api } from "@/lib/api";
import { useUrlState } from "@/lib/useUrlState";

function SystemView() {
	// Tab lives in the URL, same rule as every other view parameter.
	const [url, setUrl] = useUrlState({ tab: SYSTEM_TABS[0].id });
	const active = SYSTEM_TABS.some((t) => t.id === url.tab) ? url.tab : SYSTEM_TABS[0].id;

	const { data, isLoading } = useQuery({
		queryKey: ["system"],
		queryFn: api.system,
		// The server samples at 1 Hz and keeps 90 s of history; 2 s polling looks
		// live without shipping the same window twice a second.
		refetchInterval: 2000,
	});

	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader title="System" description="Live host metrics, sampled every second." />
			{isLoading && <p className="text-sm text-fg-muted">Reading host metrics…</p>}
			{data && <SystemPanel data={data} tab={active} onTab={(tab) => setUrl({ tab })} />}
		</div>
	);
}

export default function SystemPage() {
	return (
		<Suspense fallback={<p className="text-sm text-fg-muted">Loading…</p>}>
			<SystemView />
		</Suspense>
	);
}
