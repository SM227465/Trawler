CREATE TYPE "public"."transfer_direction" AS ENUM('up', 'down');--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "direction" "transfer_direction" DEFAULT 'up' NOT NULL;