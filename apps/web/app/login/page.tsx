"use client";
import { CloudDownload, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/app/providers";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function LoginPage() {
	const { login, user, ready } = useAuth();
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (ready && user) router.replace("/");
	}, [ready, user, router]);

	const onSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await login(email, password);
			router.replace("/");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<main className="min-h-dvh grid place-items-center p-4 sm:p-6">
			<div className="fixed top-4 right-4">
				<ThemeToggle />
			</div>

			<Card className="w-full max-w-sm p-6 sm:p-8">
				<div className="mb-6 flex flex-col items-center text-center">
					<span className="mb-3 grid size-11 place-items-center rounded-[var(--ct-radius)] bg-accent-soft text-accent">
						<CloudDownload className="size-5" aria-hidden />
					</span>
					<h1 className="text-lg font-semibold">Trawler</h1>
					<p className="mt-1 text-sm text-fg-muted">Sign in to your instance</p>
				</div>

				<form onSubmit={onSubmit} className="flex flex-col gap-3">
					{/* Explicit htmlFor/id rather than wrapping. `Input` is a component,
					    so nothing guarantees it renders a real <input> for an implicit
					    label to bind to — and if it ever stops doing so, the association
					    breaks silently. */}
					<label htmlFor="login-email" className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-fg-muted">Email</span>
						<Input
							id="login-email"
							type="email"
							autoComplete="username"
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</label>

					<label htmlFor="login-password" className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-fg-muted">Password</span>
						<Input
							id="login-password"
							type="password"
							autoComplete="current-password"
							required
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</label>

					{error && (
						<p
							role="alert"
							className="rounded-[var(--ct-radius-sm)] bg-status-errored-soft px-3 py-2 text-xs text-status-errored"
						>
							{error}
						</p>
					)}

					<Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full justify-center">
						{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
						{busy ? "Signing in…" : "Sign in"}
					</Button>
				</form>
			</Card>
		</main>
	);
}
