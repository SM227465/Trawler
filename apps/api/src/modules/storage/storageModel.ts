import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const DiskStatsSchema = z
	.object({
		totalBytes: z.number(),
		freeBytes: z.number(),
		usedBytes: z.number(),
		usedPct: z.number(),
	})
	.nullable();

export const EvictionSettingsSchema = z.object({
	budgetBytes: z.number().openapi({ description: "0 = no budget; the disk watermark alone governs." }),
	ttlHours: z.number(),
	highWatermarkPct: z.number(),
	lowWatermarkPct: z.number(),
	enabled: z.boolean(),
	archiveRemote: z.string().openapi({
		description: "Remote to copy a torrent to before deleting it. Empty means cleanup deletes outright.",
	}),
});

export const StorageStatusSchema = z.object({
	disk: DiskStatsSchema,
	settings: EvictionSettingsSchema,
	libraryBytes: z.number(),
	pressure: z.object({ overBudget: z.boolean(), overDisk: z.boolean(), active: z.boolean() }),
	atRisk: z.object({
		count: z.number(),
		bytes: z.number(),
		torrents: z.array(z.object({ id: z.string(), name: z.string(), sizeBytes: z.number() })),
	}),
});

/**
 * Watermarks are validated as a PAIR: a low mark at or above the high mark would
 * make every pass try to free the entire library, so it is refused at the edge
 * rather than defended against later.
 */
export const UpdateSettingsSchema = z.object({
	body: z
		.object({
			enabled: z.boolean().optional(),
			ttlHours: z.number().int().min(1).max(8760).optional(),
			budgetBytes: z.number().int().min(0).optional(),
			highWatermarkPct: z.number().int().min(1).max(99).optional(),
			lowWatermarkPct: z.number().int().min(1).max(99).optional(),
			/** "" turns archiving off; any other value must name a configured remote. */
			archiveRemote: z.string().max(32).optional(),
		})
		.refine(
			(b) =>
				b.lowWatermarkPct === undefined || b.highWatermarkPct === undefined || b.lowWatermarkPct < b.highWatermarkPct,
			{ message: "lowWatermarkPct must be below highWatermarkPct", path: ["lowWatermarkPct"] },
		),
});
