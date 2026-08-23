import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const FileSchema = z.object({
	id: z.string().uuid(),
	torrentId: z.string().uuid(),
	qbtIndex: z.number().int(),
	path: z.string(),
	sizeBytes: z.number(),
	progress: z.number(),
	priority: z.number().int(),
	isComplete: z.boolean(),
	contentType: z.string().nullable(),
});

export const DownloadLinkSchema = z.object({
	url: z.string().openapi({ example: "/dl/eyJhbGci…/Big%20Buck%20Bunny.mp4" }),
	absoluteUrl: z.string().openapi({ description: "Fully qualified — what the copy buttons hand out." }),
	filename: z.string(),
	sizeBytes: z.number(),
	expiresAt: z.string(),
	aria2c: z.string().openapi({ description: "Ready-to-paste 16-connection download command." }),
});

export const FileIdParams = z.object({ params: z.object({ id: z.string().uuid() }) });

export const UpdateFileSchema = z.object({
	params: z.object({ id: z.string().uuid() }),
	body: z.object({
		priority: z
			.number()
			.int()
			.refine((n) => [0, 1, 6, 7].includes(n), "priority must be 0, 1, 6 or 7"),
	}),
});

export type DownloadLink = z.infer<typeof DownloadLinkSchema>;
