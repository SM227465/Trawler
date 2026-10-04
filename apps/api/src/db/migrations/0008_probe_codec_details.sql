ALTER TABLE "media_probes" ADD COLUMN "video_profile" text;--> statement-breakpoint
ALTER TABLE "media_probes" ADD COLUMN "video_level" integer;--> statement-breakpoint
ALTER TABLE "media_probes" ADD COLUMN "bit_depth" smallint;--> statement-breakpoint
ALTER TABLE "media_probes" ADD COLUMN "frame_rate" real;--> statement-breakpoint
ALTER TABLE "media_probes" ADD COLUMN "probe_version" smallint DEFAULT 1 NOT NULL;