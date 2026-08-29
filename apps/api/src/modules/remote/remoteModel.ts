import { z } from "zod";

/**
 * The providers phase 1 ships.
 *
 * Every one of these is S3-compatible except Backblaze, which has its own
 * rclone backend and is better served by it. Choosing from a list rather than
 * asking for a provider string keeps the endpoint format out of the user's
 * hands — getting that wrong is the single most common S3 setup failure.
 */
export const REMOTE_KINDS = ["r2", "b2", "wasabi", "aws", "s3-other"] as const;
export type RemoteKind = (typeof REMOTE_KINDS)[number];

/**
 * rclone remote names appear in paths as `name:bucket/path`, so a colon or a
 * space makes an unusable remote. Restricted rather than escaped: there is no
 * reason a user needs punctuation here, and a name that round-trips cleanly is
 * worth more than the freedom.
 */
export const remoteName = z
	.string()
	.min(1)
	.max(32)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Letters, numbers, dashes and underscores only");

export const CreateRemoteSchema = z.object({
	body: z
		.object({
			name: remoteName,
			kind: z.enum(REMOTE_KINDS),
			accessKeyId: z.string().min(1),
			secretAccessKey: z.string().min(1),
			/** Bucket is required — a remote with nowhere to put things is not usable. */
			bucket: z.string().min(1).max(255),
			/** R2 and s3-other need one; AWS and Wasabi derive it from the region. */
			endpoint: z.string().max(255).optional(),
			region: z.string().max(64).optional(),
			/** Everything lands under this prefix, so one bucket can serve several boxes. */
			prefix: z.string().max(255).optional(),
		})
		.superRefine((b, ctx) => {
			// Checked here rather than at rclone, so the error names the field.
			if ((b.kind === "r2" || b.kind === "s3-other") && !b.endpoint) {
				ctx.addIssue({ code: "custom", path: ["endpoint"], message: "This provider needs an endpoint URL" });
			}
			if (b.kind === "aws" && !b.region) {
				ctx.addIssue({ code: "custom", path: ["region"], message: "AWS needs a region" });
			}
		}),
});

export const RemoteNameParams = z.object({ params: z.object({ name: remoteName }) });

export const RemoteSchema = z.object({
	name: z.string(),
	type: z.string(),
	kind: z.string().nullable(),
	bucket: z.string().nullable(),
	prefix: z.string().nullable(),
	config: z.record(z.string(), z.string()),
});
