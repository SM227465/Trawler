"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, type CreateOAuthRemoteInput, type OAuthKind } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCopy } from "@/lib/useCopy";

const PROVIDERS: { id: OAuthKind; label: string; blurb: string; ownClient?: boolean }[] = [
	{
		id: "drive",
		label: "Google Drive",
		blurb: "15 GB free, shared with Gmail and Photos.",
		// Google is retiring rclone's shared client during 2026. Without your own,
		// this stops working — and rate limits are per client, so a shared one is
		// also the difference between fast and unusable.
		ownClient: true,
	},
	{ id: "onedrive", label: "OneDrive", blurb: "5 GB free, or 1 TB with Microsoft 365." },
	{ id: "dropbox", label: "Dropbox", blurb: "2 GB free — enough for documents, not films." },
	{ id: "pcloud", label: "pCloud", blurb: "10 GB free, and the only one selling lifetime plans." },
];

const inputCls = cn(
	"h-9 w-full rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2.5",
	"text-sm text-fg outline-none transition-colors focus:border-accent placeholder:text-fg-subtle",
);

function Row({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-xs font-medium text-fg">
				{label}
			</label>
			{children}
			{hint && <span className="text-[0.6875rem] text-fg-subtle">{hint}</span>}
		</div>
	);
}

export function AddOAuthRemote({ onDone }: { onDone: () => void }) {
	const qc = useQueryClient();
	const { copied, copy } = useCopy();
	const [kind, setKind] = useState<OAuthKind>("drive");
	const [form, setForm] = useState<Partial<CreateOAuthRemoteInput>>({ name: "" });

	const provider = PROVIDERS.find((p) => p.id === kind) ?? PROVIDERS[0];
	const set = (k: keyof CreateOAuthRemoteInput, v: string) => setForm((f) => ({ ...f, [k]: v }));

	// The command must carry the same client pair the token will be used with,
	// or the provider issues a token this app cannot use and the error looks
	// like a bad paste.
	const command =
		form.clientId && form.clientSecret
			? `rclone authorize "${kind}" "${form.clientId}" "${form.clientSecret}"`
			: `rclone authorize "${kind}"`;

	const create = useMutation({
		mutationFn: () => api.createOAuthRemote({ ...(form as CreateOAuthRemoteInput), kind }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["remotes"] });
			setForm({ name: "" });
			onDone();
		},
	});

	const ready =
		Boolean(form.name && form.token) && (!provider.ownClient || Boolean(form.clientId && form.clientSecret));

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<span className="text-xs font-medium text-fg">Provider</span>
				<div className="grid gap-1.5 sm:grid-cols-2">
					{PROVIDERS.map((p) => (
						<button
							key={p.id}
							type="button"
							onClick={() => setKind(p.id)}
							aria-pressed={kind === p.id}
							className={cn(
								"cursor-pointer rounded-[var(--ct-radius-sm)] border px-3 py-2 text-left transition-colors",
								kind === p.id
									? "border-accent bg-accent-soft"
									: "border-border bg-surface-inset hover:border-border-strong",
							)}
						>
							<span className={cn("block text-sm", kind === p.id ? "font-medium text-accent" : "text-fg")}>
								{p.label}
							</span>
							<span className="mt-0.5 block text-[0.6875rem] leading-snug text-fg-subtle">{p.blurb}</span>
						</button>
					))}
				</div>
			</div>

			{provider.ownClient && (
				<div className="rounded-[var(--ct-radius-sm)] bg-status-paused-soft px-3 py-2 text-xs text-fg">
					Google is retiring rclone&apos;s shared app during 2026, so Drive needs your own OAuth client. Create one in
					the Google Cloud console (APIs &amp; Services → Credentials → OAuth client ID → Desktop app) and paste both
					halves below. Rate limits are per client, so this also decides whether transfers are fast.
				</div>
			)}

			<div className="grid gap-3 sm:grid-cols-2">
				<Row id="oa-name" label="Name" hint="How you refer to it here.">
					<input
						id="oa-name"
						className={inputCls}
						value={form.name ?? ""}
						onChange={(e) => set("name", e.target.value)}
						placeholder={kind}
					/>
				</Row>

				<Row id="oa-prefix" label="Folder (optional)" hint="Everything lands under this folder.">
					<input
						id="oa-prefix"
						className={inputCls}
						value={form.prefix ?? ""}
						onChange={(e) => set("prefix", e.target.value)}
						placeholder="Trawler"
					/>
				</Row>

				{provider.ownClient && (
					<>
						<Row id="oa-cid" label="Client ID">
							<input
								id="oa-cid"
								className={inputCls}
								value={form.clientId ?? ""}
								onChange={(e) => set("clientId", e.target.value)}
								autoComplete="off"
							/>
						</Row>
						<Row id="oa-csec" label="Client secret">
							<input
								id="oa-csec"
								className={inputCls}
								type="password"
								value={form.clientSecret ?? ""}
								onChange={(e) => set("clientSecret", e.target.value)}
								autoComplete="new-password"
							/>
						</Row>
					</>
				)}
			</div>

			{/* The step that cannot happen here. This server has no browser, so the
			    round trip happens on a machine that does and the token is carried
			    across — which is rclone's own documented answer for headless hosts. */}
			<div className="flex flex-col gap-2 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset p-3">
				<span className="text-xs font-medium text-fg">
					On your own computer, with rclone installed, run this and sign in:
				</span>
				<div className="flex items-center gap-2">
					<code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 font-mono text-xs text-fg-muted">
						{command}
					</code>
					<Button size="sm" variant="subtle" onClick={() => copy(command)}>
						{copied ? <Check className="size-3.5 text-status-completed" /> : <Copy className="size-3.5" />}
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>
				<span className="text-[0.6875rem] text-fg-subtle">
					This server has no browser, so it cannot sign you in itself. Paste everything between the arrows below, braces
					included.
				</span>
			</div>

			<Row id="oa-token" label="Token from rclone authorize">
				<textarea
					id="oa-token"
					value={form.token ?? ""}
					onChange={(e) => set("token", e.target.value)}
					rows={3}
					spellCheck={false}
					placeholder='{"access_token":"…","token_type":"Bearer","refresh_token":"…","expiry":"…"}'
					className={cn(
						"w-full rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2.5 py-2",
						"font-mono text-xs text-fg outline-none transition-colors focus:border-accent placeholder:text-fg-subtle",
					)}
				/>
			</Row>

			{create.isError && (
				<p className="rounded-[var(--ct-radius-sm)] bg-status-errored-soft px-3 py-2 text-sm text-status-errored">
					{create.error instanceof Error ? create.error.message : "Could not add that."}
				</p>
			)}

			<div className="flex justify-end gap-2">
				<Button variant="subtle" onClick={onDone}>
					Cancel
				</Button>
				<Button variant="primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
					{create.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
					{create.isPending ? "Checking…" : "Add storage"}
				</Button>
			</div>
		</div>
	);
}
