"use client";
import { CloudDownload, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/app/providers";
import { MobileNav } from "@/components/nav/MobileNav";
import { Sidebar } from "@/components/nav/Sidebar";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	const { user, ready, logout } = useAuth();
	const router = useRouter();

	useEffect(() => {
		if (ready && !user) router.replace("/login");
	}, [ready, user, router]);

	if (!ready) {
		return <div className="grid min-h-dvh place-items-center text-sm text-fg-muted">Loading…</div>;
	}
	if (!user) return null;

	return (
		// A shell with a definite height, not a scrolling document. A list that
		// should fill the screen needs an ancestor chain of known heights to fill;
		// with the page itself scrolling there is none, which is why the list used
		// to guess its own height from a viewport minus a hardcoded offset.
		<div className="flex h-dvh flex-col">
			<header className="shrink-0 border-b border-border bg-surface/90 backdrop-blur-sm">
				<div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-3 sm:px-6">
					<MobileNav />

					<span className="hidden size-8 shrink-0 place-items-center rounded-[var(--ct-radius-sm)] bg-accent-soft text-accent lg:grid">
						<CloudDownload className="size-4" aria-hidden />
					</span>
					<h1 className="mr-auto hidden truncate text-sm font-semibold lg:block">Trawler</h1>

					<span className="hidden truncate text-xs text-fg-subtle sm:block">{user.email}</span>
					<ThemeToggle />
					<Button size="icon" variant="ghost" onClick={logout} title="Sign out" aria-label="Sign out">
						<LogOut className="size-4" />
					</Button>
				</div>
			</header>

			<div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6 lg:flex-row lg:gap-8">
				<Sidebar />
				{/* Scrolling happens HERE, so the header and rail stay put. A page that
				    wants the viewport takes h-full and scrolls its own body instead. */}
				<main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
			</div>
		</div>
	);
}
