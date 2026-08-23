ALTER TABLE "egress_daily" DROP CONSTRAINT "egress_daily_day_share_id_pk";--> statement-breakpoint
-- Dropping a PRIMARY KEY does NOT remove the NOT NULL it implied, so share_id
-- would still reject the owner-download rows this change exists to allow.
ALTER TABLE "egress_daily" ALTER COLUMN "share_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "egress_daily" ADD COLUMN "id" bigserial PRIMARY KEY NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "egress_daily_day_share_key" ON "egress_daily" USING btree ("day",coalesce("share_id", ''));