import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const TransferSettingsSchema = z.object({
	dlLimitBps: z.number().openapi({ description: "0 = unlimited" }),
	upLimitBps: z.number().openapi({ description: "0 = unlimited. Seeding counts toward Oracle's 10 TB egress." }),
	altEnabled: z.boolean(),
	maxRatio: z.number().openapi({ description: "Stop seeding at this share ratio. -1 = never stop." }),
	maxRatioEnabled: z.boolean(),
	maxSeedingMinutes: z.number(),
	maxSeedingTimeEnabled: z.boolean(),
});

export const UpdateTransferSchema = z.object({
	body: z.object({
		dlLimitBps: z.number().int().min(0).optional(),
		upLimitBps: z.number().int().min(0).optional(),
		maxRatio: z.number().min(-1).max(1000).optional(),
		maxRatioEnabled: z.boolean().optional(),
		// -1 is qBittorrent's "disabled" sentinel and is what GET returns, so it
		// must round-trip through PATCH. maxRatio already allows it; this did not,
		// which made the whole form unsaveable whenever seeding time was off.
		maxSeedingMinutes: z.number().int().min(-1).optional(),
		maxSeedingTimeEnabled: z.boolean().optional(),
	}),
});
