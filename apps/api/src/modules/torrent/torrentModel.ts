import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const TorrentStatusEnum = z.enum(["queued", "downloading", "paused", "completed", "errored", "evicted"]);

export const TorrentSchema = z.object({
	id: z.string().uuid(),
	infoHash: z.string(),
	name: z.string(),
	sizeBytes: z.number(),
	status: TorrentStatusEnum,
	qbtState: z.string().nullable(),
	progress: z.number(),
	dlSpeedBps: z.number(),
	upSpeedBps: z.number(),
	etaSeconds: z.number().nullable(),
	seedsConnected: z.number(),
	seedsTotal: z.number(),
	peersConnected: z.number(),
	peersTotal: z.number(),
	ratio: z.number(),
	availability: z.number(),
	downloadedBytes: z.number(),
	uploadedBytes: z.number(),
	pinned: z.boolean(),
	addedAt: z.date(),
	completedAt: z.date().nullable(),
	// Eviction ranks by least-recently-used, so this is what the UI must show to
	// make cleanup order legible rather than mysterious.
	lastAccessedAt: z.date().nullable(),
});
export type Torrent = z.infer<typeof TorrentSchema>;

export const AddTorrentSchema = z.object({
	body: z.object({
		magnet: z
			.string()
			.min(1)
			.refine((v) => v.startsWith("magnet:?"), "must be a magnet URI"),
		pinned: z.boolean().optional().default(false),
	}),
});

export const TorrentIdSchema = z.object({
	params: z.object({ id: z.string().uuid("must be a torrent uuid") }),
});

export const ListTorrentsSchema = z.object({
	query: z.object({
		status: TorrentStatusEnum.optional(),
		q: z.string().max(200).optional(),
		limit: z.coerce.number().int().min(1).max(200).optional().default(50),
		offset: z.coerce.number().int().min(0).optional().default(0),
	}),
});

export const DeleteTorrentSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	query: z.object({
		deleteFiles: z
			.enum(["true", "false"])
			.optional()
			.default("true")
			.transform((v) => v === "true"),
	}),
});

/** Batch add. Per-item outcomes, because a partial failure must not fail the lot. */
export const BatchAddSchema = z.object({
	body: z.object({
		magnets: z.array(z.string().min(1)).min(1).max(50),
	}),
});

export const BatchResultSchema = z.object({
	results: z.array(
		z.object({
			input: z.string().openapi({ description: "Truncated for display; never the full magnet." }),
			status: z.enum(["added", "duplicate", "failed"]),
			id: z.string().nullable(),
			name: z.string().nullable(),
			error: z.string().nullable(),
		}),
	),
	added: z.number(),
	duplicates: z.number(),
	failed: z.number(),
});
