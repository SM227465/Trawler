CREATE TYPE "public"."playback_mode" AS ENUM('direct', 'remux', 'incompatible', 'not_media');--> statement-breakpoint
CREATE TYPE "public"."share_scope" AS ENUM('file', 'torrent');--> statement-breakpoint
CREATE TYPE "public"."torrent_status" AS ENUM('queued', 'downloading', 'paused', 'completed', 'errored', 'evicted');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "egress_daily" (
	"day" date NOT NULL,
	"share_id" text,
	"bytes_served" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "egress_daily_day_share_id_pk" PRIMARY KEY("day","share_id")
);
--> statement-breakpoint
CREATE TABLE "media_probes" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"container" text,
	"video_codec" text,
	"audio_codec" text,
	"width" integer,
	"height" integer,
	"duration_seconds" real,
	"bitrate_bps" bigint,
	"playback" "playback_mode" NOT NULL,
	"probed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"probe_error" text
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "share_access_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"share_id" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"status" smallint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "share_scope" NOT NULL,
	"torrent_id" uuid,
	"file_id" uuid,
	"created_by" uuid NOT NULL,
	"label" text,
	"password_hash" text,
	"allow_stream" boolean DEFAULT true NOT NULL,
	"allow_download" boolean DEFAULT true NOT NULL,
	"max_bytes" bigint,
	"bytes_served" bigint DEFAULT 0 NOT NULL,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_scope_target_ck" CHECK ((scope = 'file'    AND file_id IS NOT NULL AND torrent_id IS NULL) OR
			    (scope = 'torrent' AND torrent_id IS NOT NULL AND file_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "torrent_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"torrent_id" uuid NOT NULL,
	"qbt_index" integer NOT NULL,
	"path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"priority" smallint DEFAULT 1 NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"content_type" text
);
--> statement-breakpoint
CREATE TABLE "torrent_trackers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"torrent_id" uuid NOT NULL,
	"url" text NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"status" smallint NOT NULL,
	"num_peers" integer DEFAULT 0 NOT NULL,
	"num_seeds" integer DEFAULT 0 NOT NULL,
	"num_leeches" integer DEFAULT 0 NOT NULL,
	"num_downloaded" integer DEFAULT 0 NOT NULL,
	"message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "torrents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"info_hash" text NOT NULL,
	"name" text NOT NULL,
	"magnet" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"status" "torrent_status" DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"dl_speed_bps" bigint DEFAULT 0 NOT NULL,
	"up_speed_bps" bigint DEFAULT 0 NOT NULL,
	"eta_seconds" integer,
	"save_path" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"evicted_at" timestamp with time zone,
	"qbt_state" text,
	"seeds_connected" integer DEFAULT 0 NOT NULL,
	"seeds_total" integer DEFAULT 0 NOT NULL,
	"peers_connected" integer DEFAULT 0 NOT NULL,
	"peers_total" integer DEFAULT 0 NOT NULL,
	"ratio" real DEFAULT 0 NOT NULL,
	"availability" real DEFAULT 0 NOT NULL,
	"downloaded_bytes" bigint DEFAULT 0 NOT NULL,
	"uploaded_bytes" bigint DEFAULT 0 NOT NULL,
	"wasted_bytes" bigint DEFAULT 0 NOT NULL,
	"time_active_seconds" integer DEFAULT 0 NOT NULL,
	"seeding_time_seconds" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone,
	"info_hash_v2" text,
	"pieces_have" integer DEFAULT 0 NOT NULL,
	"pieces_num" integer DEFAULT 0 NOT NULL,
	"piece_size_bytes" bigint,
	"is_private" boolean DEFAULT false NOT NULL,
	"comment" text,
	"created_by_client" text,
	"torrent_created_at" timestamp with time zone,
	"content_path" text,
	"category" text,
	"tags" text[],
	"tracker_host" text,
	"trackers_count" integer DEFAULT 0 NOT NULL,
	"dl_limit_bps" bigint,
	"up_limit_bps" bigint
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "egress_daily" ADD CONSTRAINT "egress_daily_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_probes" ADD CONSTRAINT "media_probes_file_id_torrent_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."torrent_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_access_log" ADD CONSTRAINT "share_access_log_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_torrent_id_torrents_id_fk" FOREIGN KEY ("torrent_id") REFERENCES "public"."torrents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_file_id_torrent_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."torrent_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "torrent_files" ADD CONSTRAINT "torrent_files_torrent_id_torrents_id_fk" FOREIGN KEY ("torrent_id") REFERENCES "public"."torrents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "torrent_trackers" ADD CONSTRAINT "torrent_trackers_torrent_id_torrents_id_fk" FOREIGN KEY ("torrent_id") REFERENCES "public"."torrents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "torrents" ADD CONSTRAINT "torrents_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "egress_daily_day_idx" ON "egress_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "share_access_log_share_at_idx" ON "share_access_log" USING btree ("share_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "share_access_log_at_idx" ON "share_access_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "shares_expires_idx" ON "shares" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "shares_file_idx" ON "shares" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "shares_torrent_idx" ON "shares" USING btree ("torrent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "torrent_files_torrent_path_key" ON "torrent_files" USING btree ("torrent_id","path");--> statement-breakpoint
CREATE INDEX "torrent_files_torrent_idx" ON "torrent_files" USING btree ("torrent_id");--> statement-breakpoint
CREATE INDEX "torrent_files_complete_idx" ON "torrent_files" USING btree ("torrent_id","is_complete");--> statement-breakpoint
CREATE UNIQUE INDEX "torrent_trackers_torrent_url_key" ON "torrent_trackers" USING btree ("torrent_id","url");--> statement-breakpoint
CREATE INDEX "torrent_trackers_torrent_idx" ON "torrent_trackers" USING btree ("torrent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "torrents_info_hash_key" ON "torrents" USING btree ("info_hash");--> statement-breakpoint
CREATE INDEX "torrents_status_idx" ON "torrents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "torrents_evict_idx" ON "torrents" USING btree ("status","last_accessed_at");--> statement-breakpoint
CREATE INDEX "torrents_added_at_idx" ON "torrents" USING btree ("added_at" DESC NULLS LAST);