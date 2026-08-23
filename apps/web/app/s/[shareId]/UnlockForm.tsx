"use client";
import { LoaderCircle, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export function UnlockForm({ shareId }: { shareId: string }) {
	const router = useRouter();
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/v1/public/shares/${shareId}/unlock`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ password }),
			});
			if (!res.ok) {
				setError("That password is not right.");
				return;
			}
			// The unlock cookie is httpOnly, so re-render on the server to pick it up.
			router.refresh();
		} catch {
			setError("Could not reach the server.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<form onSubmit={submit} className="mt-6">
			<label htmlFor="share-password" className="flex items-center gap-2 text-sm text-fg">
				<Lock className="size-4 text-fg-subtle" aria-hidden />
				This link is password protected
			</label>

			<div className="mt-3 flex flex-col gap-2 sm:flex-row">
				<input
					id="share-password"
					type="password"
					autoComplete="off"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password"
					className={cn(
						"h-10 flex-1 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-3",
						"text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors focus:border-accent",
					)}
				/>
				<Button type="submit" variant="primary" disabled={busy || !password} className="justify-center">
					{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
					Unlock
				</Button>
			</div>

			{error && (
				<p role="alert" className="mt-2 text-xs text-status-errored">
					{error}
				</p>
			)}
		</form>
	);
}
