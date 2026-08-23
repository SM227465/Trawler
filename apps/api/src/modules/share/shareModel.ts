import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const ShareSchema = z.object({
	id: z.string(),
	scope: z.enum(["file", "torrent"]),
	torrentId: z.string().uuid().nullable(),
	fileId: z.string().uuid().nullable(),
	label: z.string().nullable(),
	hasPassword: z.boolean(),
	allowStream: z.boolean(),
	allowDownload: z.boolean(),
	maxBytes: z.number().nullable(),
	bytesServed: z.number(),
	requestCount: z.number(),
	expiresAt: z.string().nullable(),
	revokedAt: z.string().nullable(),
	lastAccessedAt: z.string().nullable(),
	createdAt: z.string(),
	url: z.string(),
	state: z.enum(["active", "revoked", "expired", "quota"]),
});

export const CreateShareSchema = z.object({
	body: z
		.object({
			fileId: z.string().uuid().optional(),
			torrentId: z.string().uuid().optional(),
			label: z.string().max(120).optional(),
			password: z.string().min(4).max(200).optional(),
			// null = never expires; omitted = the app default (7 days).
			expiresInHours: z.number().int().min(1).max(8760).nullable().optional(),
			// null = unlimited; omitted = the app default (5x the file size).
			maxBytes: z.number().int().min(0).nullable().optional(),
			allowDownload: z.boolean().optional(),
			allowStream: z.boolean().optional(),
		})
		.refine((b) => (b.fileId === undefined) !== (b.torrentId === undefined), {
			message: "provide exactly one of fileId or torrentId",
			path: ["fileId"],
		}),
});

export const ShareIdParams = z.object({ params: z.object({ id: z.string().min(8).max(32) }) });

export const UnlockShareSchema = z.object({
	params: z.object({ id: z.string().min(8).max(32) }),
	body: z.object({ password: z.string().min(1).max(200) }),
});
