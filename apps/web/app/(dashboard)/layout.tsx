"use client";
import { CloudDownload, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/app/providers";
import { Button } from "@/components/ui/Button";
import { Sidebar } from "@/components/nav/Sidebar";
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
		<div className="min-h-dvh">
			<header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur-sm">
				<div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-3 sm:px-6">
					<span className="grid size-8 shrink-0 place-items-center rounded-[var(--ct-radius-sm)] bg-accent-soft text-accent">
						<CloudDownload className="size-4" aria-hidden />
					</span>
					<h1 className="mr-auto truncate text-sm font-semibold">Cloud Torrent</h1>

					<span className="hidden truncate text-xs text-fg-subtle sm:block">{user.email}</span>
					<ThemeToggle />
					<Button size="icon" variant="ghost" onClick={logout} title="Sign out" aria-label="Sign out">
						<LogOut className="size-4" />
					</Button>
				</div>
			</header>

			<div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6 lg:flex-row lg:gap-8">
				<Sidebar />
				<main className="min-w-0 flex-1">{children}</main>
			</div>
		</div>
	);
}
