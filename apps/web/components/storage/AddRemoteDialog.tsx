"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { api, type CreateRemoteInput, type RemoteKind } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * A list rather than a free-text provider field. Endpoint format is the single
 * most common S3 setup mistake, so each preset states what its endpoint looks
 * like and hides the fields that provider does not use.
 */
const KINDS: {
	id: RemoteKind;
	label: string;
	blurb: string;
	needsEndpoint?: boolean;
	needsRegion?: boolean;
	endpointHint?: string;
	keyLabel?: string;
	secretLabel?: string;
}[] = [
	{
		id: "r2",
		label: "Cloudflare R2",
		blurb: "10 GB free, and no charge for downloading — the best fit for this.",
		needsEndpoint: true,
		endpointHint: "<account-id>.r2.cloudflarestorage.com",
	},
	{
		id: "b2",
		label: "Backblaze B2",
		blurb: "10 GB free, $6/TB after. Free downloads up to 3× what you store.",
		keyLabel: "Key ID",
		secretLabel: "Application key",
	},
	{ id: "wasabi", label: "Wasabi", blurb: "No download fees, but a minimum monthly charge.", needsRegion: true },
	{ id: "aws", label: "Amazon S3", blurb: "Charges for every gigabyte downloaded. Watch that.", needsRegion: true },
	{
		id: "s3-other",
		label: "Other S3-compatible",
		blurb: "MinIO, Hetzner, IDrive e2, MEGA S4, or anything speaking S3.",
		needsEndpoint: true,
		needsRegion: true,
		endpointHint: "s3.example.com",
	},
];

/**
 * Explicit htmlFor rather than a <label> wrapped around {children}: the
 * association is then real for a screen reader and statically checkable, where
 * wrapping only looks correct.
 */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
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

const inputCls = cn(
	"h-9 w-full rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2.5",
	"text-sm text-fg outline-none transition-colors focus:border-accent placeholder:text-fg-subtle",
);

export function AddRemoteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const qc = useQueryClient();
	const [kind, setKind] = useState<RemoteKind>("r2");
	const [form, setForm] = useState<Partial<CreateRemoteInput>>({ name: "", bucket: "" });

	const preset = KINDS.find((k) => k.id === kind) ?? KINDS[0];
	const set = (k: keyof CreateRemoteInput, v: string) => setForm((f) => ({ ...f, [k]: v }));

	const create = useMutation({
		mutationFn: () => api.createRemote({ ...(form as CreateRemoteInput), kind }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["remotes"] });
			setForm({ name: "", bucket: "" });
			onClose();
		},
	});

	const ready =
		Boolean(form.name && form.bucket && form.accessKeyId && form.secretAccessKey) &&
		(!preset.needsEndpoint || Boolean(form.endpoint)) &&
		(!preset.needsRegion || Boolean(form.region));

	return (
		<Dialog
			open={open}
			onClose={onClose}
			title="Add storage"
			description="Somewhere to copy finished files. Nothing is uploaded until you ask for it."
		>
			<div className="mt-4 flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<span className="text-xs font-medium text-fg">Provider</span>
					<div className="grid gap-1.5 sm:grid-cols-2">
						{KINDS.map((k) => (
							<button
								key={k.id}
								type="button"
								onClick={() => setKind(k.id)}
								aria-pressed={kind === k.id}
								className={cn(
									"cursor-pointer rounded-[var(--ct-radius-sm)] border px-3 py-2 text-left transition-colors",
									kind === k.id
										? "border-accent bg-accent-soft"
										: "border-border bg-surface-inset hover:border-border-strong",
								)}
							>
								<span className={cn("block text-sm", kind === k.id ? "font-medium text-accent" : "text-fg")}>
									{k.label}
								</span>
								<span className="mt-0.5 block text-[0.6875rem] leading-snug text-fg-subtle">{k.blurb}</span>
							</button>
						))}
					</div>
				</div>

				<div className="grid gap-3 sm:grid-cols-2">
					<Field id="rf-name" label="Name" hint="How you refer to it here.">
						<input
							id="rf-name"
							className={inputCls}
							value={form.name ?? ""}
							onChange={(e) => set("name", e.target.value)}
							placeholder="r2"
						/>
					</Field>

					<Field id="rf-bucket" label="Bucket">
						<input
							id="rf-bucket"
							className={inputCls}
							value={form.bucket ?? ""}
							onChange={(e) => set("bucket", e.target.value)}
							placeholder="trawler"
						/>
					</Field>

					<Field id="rf-accessKeyId" label={preset.keyLabel ?? "Access key ID"}>
						<input
							id="rf-accessKeyId"
							className={inputCls}
							value={form.accessKeyId ?? ""}
							onChange={(e) => set("accessKeyId", e.target.value)}
							autoComplete="off"
						/>
					</Field>

					<Field id="rf-secretAccessKey" label={preset.secretLabel ?? "Secret access key"}>
						<input
							id="rf-secretAccessKey"
							className={inputCls}
							type="password"
							value={form.secretAccessKey ?? ""}
							onChange={(e) => set("secretAccessKey", e.target.value)}
							autoComplete="new-password"
						/>
					</Field>

					{preset.needsEndpoint && (
						<Field id="rf-endpoint" label="Endpoint" hint={preset.endpointHint}>
							<input
								id="rf-endpoint"
								className={inputCls}
								value={form.endpoint ?? ""}
								onChange={(e) => set("endpoint", e.target.value)}
								placeholder={preset.endpointHint}
							/>
						</Field>
					)}

					{preset.needsRegion && (
						<Field id="rf-region" label="Region">
							<input
								id="rf-region"
								className={inputCls}
								value={form.region ?? ""}
								onChange={(e) => set("region", e.target.value)}
								placeholder="us-east-1"
							/>
						</Field>
					)}

					<Field id="rf-prefix" label="Folder (optional)" hint="Everything lands under this prefix.">
						<input
							id="rf-prefix"
							className={inputCls}
							value={form.prefix ?? ""}
							onChange={(e) => set("prefix", e.target.value)}
							placeholder="trawler"
						/>
					</Field>
				</div>

				<p className="text-xs text-fg-muted">
					The connection is tested before this is saved, so wrong keys or a missing bucket are reported now rather than
					at the first upload. Credentials are stored on the server, outside the database.
				</p>

				{create.isError && (
					<p className="rounded-[var(--ct-radius-sm)] bg-status-errored-soft px-3 py-2 text-sm text-status-errored">
						{create.error instanceof Error ? create.error.message : "Could not add that."}
					</p>
				)}

				<div className="flex justify-end gap-2">
					<Button variant="subtle" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
						{create.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
						{create.isPending ? "Testing…" : "Add storage"}
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
