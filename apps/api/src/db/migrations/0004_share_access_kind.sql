CREATE TYPE "public"."share_access_kind" AS ENUM('view', 'download', 'denied', 'unlock_failed');--> statement-breakpoint
ALTER TABLE "share_access_log" ADD COLUMN "kind" "share_access_kind" DEFAULT 'download' NOT NULL;--> statement-breakpoint
ALTER TABLE "share_access_log" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE INDEX "share_access_log_kind_idx" ON "share_access_log" USING btree ("share_id","kind");