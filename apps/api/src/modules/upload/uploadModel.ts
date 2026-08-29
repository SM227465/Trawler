import { z } from "zod";

export const CreateUploadSchema = z.object({
	body: z.object({
		remote: z.string().min(1).max(32),
		/** Relative to the downloads root — the same path the file browser uses. */
		path: z.string().min(1).max(1024),
		/** "down" restores from the remote back onto the disk. */
		direction: z.enum(["up", "down"]).optional(),
	}),
});

export const UploadIdParams = z.object({ params: z.object({ id: z.string().uuid() }) });

export const UploadSchema = z.object({
	id: z.string(),
	remoteName: z.string(),
	srcPath: z.string(),
	dstFs: z.string(),
	direction: z.enum(["up", "down"]),
	status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
	bytesTotal: z.number(),
	bytesDone: z.number(),
	speedBps: z.number().optional(),
	etaSeconds: z.number().nullable().optional(),
	error: z.string().nullable(),
	createdAt: z.string(),
	finishedAt: z.string().nullable(),
});
