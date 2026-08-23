"use client";
import { ChevronDown } from "lucide-react";
import { Suspense, useState } from "react";
import { FileBrowser } from "@/components/files/FileBrowser";
import { PageHeader } from "@/components/nav/PageHeader";
import { WebdavAccess } from "@/components/settings/WebdavAccess";
import { cn } from "@/lib/cn";
import { useUrlState } from "@/lib/useUrlState";

function FilesView() {
	// The browsed folder is URL state too, so a folder can be linked and survives
	// a reload — the same rule as the Transfers view.
	const [url, setUrl] = useUrlState({ path: "" });
	const [showMount, setShowMount] = useState(false);

	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<PageHeader title="Files" description="Browse finished downloads and grab individual files." />

			<FileBrowser path={url.path} onNavigate={(path) => setUrl({ path })} />

			<div>
				<button
					type="button"
					onClick={() => setShowMount((v) => !v)}
					aria-expanded={showMount}
					className={cn(
						"inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--ct-radius-sm)] px-2 py-1.5",
						"text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
					)}
				>
					<ChevronDown className={cn("size-4 transition-transform", showMount && "rotate-180")} aria-hidden />
					Mount as a network drive (WebDAV)
				</button>

				{showMount && (
					<div className="mt-3">
						<WebdavAccess />
					</div>
				)}
			</div>
		</div>
	);
}

export default function FilesPage() {
	return (
		<Suspense fallback={<p className="text-sm text-fg-muted">Loading…</p>}>
			<FilesView />
		</Suspense>
	);
}
