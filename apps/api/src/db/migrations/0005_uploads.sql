CREATE TYPE "public"."upload_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"remote_name" text NOT NULL,
	"src_path" text NOT NULL,
	"dst_fs" text NOT NULL,
	"status" "upload_status" DEFAULT 'queued' NOT NULL,
	"rclone_job_id" integer,
	"bytes_total" bigint DEFAULT 0 NOT NULL,
	"bytes_done" bigint DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "uploads_created_idx" ON "uploads" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "uploads_status_idx" ON "uploads" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_active_src_key" ON "uploads" USING btree ("src_path") WHERE status in ('queued','running');