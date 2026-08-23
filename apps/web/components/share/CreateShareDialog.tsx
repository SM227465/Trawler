"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { api, type Share } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { useCopy } from "@/lib/useCopy";

const EXPIRY = [
	{ label: "1 hour", hours: 1 },
	{ label: "24 hours", hours: 24 },
	{ label: "7 days", hours: 168 },
	{ label: "30 days", hours: 720 },
	{ label: "Never", hours: null },
] as const;

export function CreateShareDialog({
	open,
	onClose,
	fileId,
	torrentId,
	defaultLabel,
	sizeBytes,
}: {
	open: boolean;
	onClose: () => void;
	fileId?: string;
	torrentId?: string;
	defaultLabel?: string;
	sizeBytes?: number;
}) {
	const qc = useQueryClient();
	const { copied, copy } = useCopy();

	const [label, setLabel] = useState(defaultLabel ?? "");
	const [expiryHours, setExpiryHours] = useState<number | null>(168);
	const [usePassword, setUsePassword] = useState(false);
	const [password, setPassword] = useState("");
	const [limitBytes, setLimitBytes] = useState(true);
	const [allowDownload, setAllowDownload] = useState(true);
	const [created, setCreated] = useState<Share | null>(null);

	useEffect(() => {
		if (open) {
			setLabel(defaultLabel ?? "");
			setExpiryHours(168);
			setUsePassword(false);
			setPassword("");
			setLimitBytes(true);
			setAllowDownload(true);
			setCreated(null);
		}
	}, [open, defaultLabel]);

	const create = useMutation({
		mutationFn: () =>
			api.createShare({
				fileId,
				torrentId,
				label: label.trim() || undefined,
				password: usePassword && password ? password : undefined,
				expiresInHours: expiryHours,
				// null = unlimited; omitting it lets the server apply its default.
				maxBytes: limitBytes ? undefined : null,
				allowDownload,
			}),
		onSuccess: (share) => {
			setCreated(share);
			qc.invalidateQueries({ queryKey: ["shares"] });
		},
	});

	if (created) {
		return (
			<Dialog open={open} onClose={onClose} title="Link ready" description={created.label ?? undefined}>
				<div className="mt-4 flex gap-2">
					<code className="min-w-0 flex-1 truncate rounded-[var(--ct-radius-sm)] bg-surface-inset px-3 py-2 font-mono text-xs text-fg">
						{created.url}
					</code>
					<Button variant="primary" onClick={() => copy(created.url)}>
						{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>

				<ul className="mt-4 space-y-1 text-xs text-fg-muted">
					<li>Expires: {created.expiresAt ? new Date(created.expiresAt).toLocaleString() : "never"}</li>
					<li>Limit: {created.maxBytes ? formatBytes(created.maxBytes) : "unlimited"}</li>
					{created.hasPassword && <li>Password required</li>}
				</ul>

				<p className="mt-3 text-xs text-fg-subtle">
					Anyone with this link can download it. Revoke it any time from the Shares page.
				</p>

				<div className="mt-5 flex justify-end">
					<Button variant="subtle" onClick={onClose}>
						Done
					</Button>
				</div>
			</Dialog>
		);
	}

	return (
		<Dialog open={open} onClose={onClose} title="Create a share link" description={defaultLabel}>
			<div className="mt-5 space-y-5">
				<label className="block">
					<span className="block text-sm text-fg">Label</span>
					<span className="mt-0.5 block text-xs text-fg-muted">Shown on the page and in chat previews.</span>
					<input
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder={defaultLabel ?? "Optional"}
						className={cn(
							"mt-1.5 h-9 w-full rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2.5",
							"text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent",
						)}
					/>
				</label>

				<div>
					<span className="block text-sm text-fg">Expires after</span>
					<div className="mt-2 flex flex-wrap gap-1.5">
						{EXPIRY.map((e) => (
							<button
								key={e.label}
								type="button"
								onClick={() => setExpiryHours(e.hours)}
								className={cn(
									"cursor-pointer rounded-full px-3 py-1 text-xs transition-colors",
									expiryHours === e.hours
										? "bg-accent text-accent-fg"
										: "bg-surface-inset text-fg-muted hover:text-fg",
								)}
							>
								{e.label}
							</button>
						))}
					</div>
				</div>

				<Checkbox
					label="Limit total downloads"
					hint={
						sizeBytes
							? `Stops serving after about ${formatBytes(sizeBytes * 5)} — roughly five full downloads.`
							: "Stops serving after roughly five full downloads."
					}
					checked={limitBytes}
					onChange={(e) => setLimitBytes(e.target.checked)}
				/>

				<div>
					<Checkbox
						label="Require a password"
						hint="The page shows nothing at all — not even the filename — until it is entered."
						checked={usePassword}
						onChange={(e) => setUsePassword(e.target.checked)}
					/>
					{usePassword && (
						<input
							type="text"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="Password (min 4 characters)"
							className={cn(
								"mt-2 h-9 w-full rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2.5",
								"text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent",
							)}
						/>
					)}
				</div>

				<Checkbox
					label="Allow downloading"
					hint="Turn off to share a preview page without the file."
					checked={allowDownload}
					onChange={(e) => setAllowDownload(e.target.checked)}
				/>
			</div>

			{create.isError && (
				<p role="alert" className="mt-3 text-xs text-status-errored">
					{create.error instanceof Error ? create.error.message : "Could not create the link"}
				</p>
			)}

			<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button variant="subtle" onClick={onClose} className="justify-center">
					Cancel
				</Button>
				<Button
					variant="primary"
					onClick={() => create.mutate()}
					disabled={create.isPending || (usePassword && password.length < 4)}
					className="justify-center"
				>
					{create.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
					Create link
				</Button>
			</div>
		</Dialog>
	);
}
