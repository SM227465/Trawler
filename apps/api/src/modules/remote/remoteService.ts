import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { logger } from "@/common/utils/logger";
import { RcloneError, rclone, redactConfig } from "@/integrations/rclone/client";
import type { OAuthKind, RemoteKind } from "./remoteModel";
import { remoteRepository } from "./remoteRepository";

interface CreateInput {
	name: string;
	kind: RemoteKind;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	endpoint?: string;
	region?: string;
	prefix?: string;
}

/**
 * Maps a preset to rclone's own backend and provider values.
 *
 * Backblaze is the odd one: it is S3-compatible, but rclone ships a dedicated
 * `b2` backend that knows about its application keys and lifecycle rules, and
 * rclone's own S3 provider list does not include it. Use the backend that was
 * written for it.
 */
function toRcloneConfig(input: CreateInput): { type: string; parameters: Record<string, string> } {
	if (input.kind === "b2") {
		return {
			type: "b2",
			parameters: { account: input.accessKeyId, key: input.secretAccessKey },
		};
	}

	const provider = { r2: "Cloudflare", wasabi: "Wasabi", aws: "AWS", "s3-other": "Other" }[input.kind] ?? "Other";
	const parameters: Record<string, string> = {
		provider,
		access_key_id: input.accessKeyId,
		secret_access_key: input.secretAccessKey,
	};
	if (input.endpoint) parameters.endpoint = input.endpoint.replace(/^https?:\/\//, "");
	// R2 has one region and rejects anything else; rclone's own docs use "auto".
	if (input.kind === "r2") parameters.region = "auto";
	else if (input.region) parameters.region = input.region;

	return { type: "s3", parameters };
}

/** `name:bucket/prefix` — what every rclone operation addresses. */
export function remoteFs(name: string, bucket: string, prefix?: string): string {
	const path = [bucket, (prefix ?? "").replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/");
	return `${name}:${path}`;
}

interface CreateOAuthInput {
	name: string;
	kind: OAuthKind;
	token: string;
	clientId?: string;
	clientSecret?: string;
	prefix?: string;
}

class RemoteService {
	async available(): Promise<boolean> {
		return rclone.reachable();
	}

	async list() {
		if (!(await rclone.reachable())) {
			return ServiceResponse.success("External storage is not running", { available: false, remotes: [] });
		}

		const [remotes, meta] = await Promise.all([rclone.remotesWithTypes(), remoteRepository.all()]);
		const detailed = await Promise.all(
			remotes.map(async (r) => ({
				name: r.name,
				type: r.type,
				kind: meta[r.name]?.kind ?? null,
				bucket: meta[r.name]?.bucket ?? null,
				prefix: meta[r.name]?.prefix ?? null,
				// Redacted, always. The raw config contains a working secret key.
				config: await rclone.remoteConfigRedacted(r.name).catch(() => ({})),
			})),
		);
		return ServiceResponse.success("Remotes", { available: true, remotes: detailed });
	}

	/**
	 * Creates the remote, then immediately proves it works.
	 *
	 * A remote that was accepted but cannot reach its bucket is worse than a
	 * rejected one: it sits in the list looking configured until the first upload
	 * fails hours later. So a failing test rolls the remote back out again and
	 * reports the provider's own words.
	 */
	async create(input: CreateInput) {
		if (!(await rclone.reachable())) {
			return ServiceResponse.failure(
				"External storage is not running",
				null,
				ErrorCode.INTERNAL_ERROR,
				"RCLONE_UNAVAILABLE",
			);
		}

		const { type, parameters } = toRcloneConfig(input);

		try {
			await rclone.createRemote(input.name, type, parameters);
		} catch (err) {
			logger.error({ err, name: input.name }, "could not create rclone remote");
			return ServiceResponse.failure(
				err instanceof RcloneError ? err.message : "Could not save the remote",
				null,
				ErrorCode.VALIDATION_ERROR,
				"REMOTE_REJECTED",
			);
		}

		const result = await rclone.testRemote(input.name, [input.bucket, input.prefix].filter(Boolean).join("/"));
		if (!result.ok) {
			await rclone.deleteRemote(input.name).catch(() => undefined);
			return ServiceResponse.failure(result.error, null, ErrorCode.VALIDATION_ERROR, "REMOTE_UNREACHABLE");
		}

		await remoteRepository.set(input.name, {
			kind: input.kind,
			bucket: input.bucket,
			prefix: (input.prefix ?? "").replace(/^\/+|\/+$/g, ""),
		});

		logger.info({ name: input.name, kind: input.kind, type }, "remote configured");
		return ServiceResponse.success("Remote added", { name: input.name, about: result.about });
	}

	/**
	 * Creates a remote from a token obtained elsewhere.
	 *
	 * This server has no browser, so it cannot complete an OAuth round trip
	 * itself. rclone's documented answer is to run `rclone authorize` on a
	 * machine that does have one and carry the token across — which is what this
	 * takes. No redirect URI to register, and the secret never travels through
	 * this app's own auth flow.
	 *
	 * The client id and secret must be the SAME pair given to `rclone authorize`.
	 * A token issued to one client is not valid for another, and the failure
	 * looks like a bad token rather than a mismatched client, so the form says so.
	 */
	async createOAuth(input: CreateOAuthInput) {
		if (!(await rclone.reachable())) {
			return ServiceResponse.failure(
				"External storage is not running",
				null,
				ErrorCode.INTERNAL_ERROR,
				"RCLONE_UNAVAILABLE",
			);
		}

		const parameters: Record<string, string> = { token: input.token.trim() };
		if (input.clientId) parameters.client_id = input.clientId;
		if (input.clientSecret) parameters.client_secret = input.clientSecret;

		try {
			await rclone.createRemote(input.name, input.kind, parameters);
		} catch (err) {
			logger.error({ err, name: input.name }, "could not create oauth remote");
			return ServiceResponse.failure(
				err instanceof RcloneError ? err.message : "Could not save the remote",
				null,
				ErrorCode.VALIDATION_ERROR,
				"REMOTE_REJECTED",
			);
		}

		const prefix = (input.prefix ?? "").replace(/^\/+|\/+$/g, "");
		const result = await rclone.testRemote(input.name, prefix);
		if (!result.ok) {
			await rclone.deleteRemote(input.name).catch(() => undefined);
			return ServiceResponse.failure(result.error, null, ErrorCode.VALIDATION_ERROR, "REMOTE_UNREACHABLE");
		}

		// No bucket: for these providers the account is the root and the prefix
		// is the only addressing there is.
		await remoteRepository.set(input.name, { kind: input.kind, bucket: "", prefix });

		logger.info({ name: input.name, kind: input.kind }, "oauth remote configured");
		return ServiceResponse.success("Remote added", { name: input.name, about: result.about });
	}

	async test(name: string) {
		const meta = await remoteRepository.get(name);
		const path = meta ? [meta.bucket, meta.prefix].filter(Boolean).join("/") : "";
		const result = await rclone.testRemote(name, path);
		return result.ok
			? ServiceResponse.success("Reachable", { ok: true, about: result.about })
			: ServiceResponse.failure(result.error, { ok: false }, ErrorCode.VALIDATION_ERROR, "REMOTE_UNREACHABLE");
	}

	/**
	 * Lists one directory of a remote, so an archived torrent can be found and
	 * brought back.
	 *
	 * Paths are relative to the remote's own bucket and prefix, exactly like the
	 * local file browser is relative to the downloads root. The caller never
	 * addresses the bucket directly, so a share of the same bucket with other
	 * software stays out of reach.
	 */
	async browse(name: string, rawPath: string | undefined) {
		const meta = await remoteRepository.get(name);
		if (!meta) {
			return ServiceResponse.failure("No such storage", null, ErrorCode.RESOURCE_NOT_FOUND, "REMOTE_NOT_FOUND");
		}

		// `..` would escape the prefix this remote is confined to.
		const rel = (rawPath ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
		if (rel.split("/").includes("..")) {
			return ServiceResponse.failure("Invalid path", null, ErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");
		}

		try {
			const entries = await rclone.listPath(remoteFs(name, meta.bucket, meta.prefix), rel);
			return ServiceResponse.success("Listing", {
				path: rel,
				parent: rel === "" ? null : rel.split("/").slice(0, -1).join("/"),
				entries: entries
					.map((e) => ({
						name: e.Name,
						path: rel ? `${rel}/${e.Name}` : e.Name,
						type: e.IsDir ? ("dir" as const) : ("file" as const),
						sizeBytes: e.IsDir ? 0 : e.Size,
						modifiedAt: e.ModTime,
					}))
					.sort((a, b) =>
						a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1,
					),
			});
		} catch (err) {
			logger.warn({ err, name, rel }, "remote listing failed");
			return ServiceResponse.failure(
				err instanceof RcloneError ? err.message : "Could not read that folder",
				null,
				ErrorCode.INTERNAL_ERROR,
				"REMOTE_UNREACHABLE",
			);
		}
	}

	/**
	 * Forgets the remote here. NOTHING is deleted at the provider — the same rule
	 * the rest of the app follows, and doubly so for data on someone else's disk
	 * that this app did not pay for.
	 */
	async remove(name: string) {
		await rclone.deleteRemote(name).catch(() => undefined);
		await remoteRepository.remove(name);
		logger.info({ name }, "remote removed - nothing deleted at the provider");
		return ServiceResponse.success("Remote removed", { name });
	}
}

export const remoteService = new RemoteService();
