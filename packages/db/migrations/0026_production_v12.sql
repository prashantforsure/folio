-- 0026 - the Production route, v12 (2026-09-22).
--
-- `docs/production/production.md` §7, table for table, on the spec's own
-- vocabulary: every §6 enumeration is a Postgres enum below with its values
-- unchanged. `schema/production.ts` names the two deviations (`reel_shots`
-- for the spec's `shots`, which the Storyboard owns; `scene_node_id` for
-- its `scene_id`) and what is folded rather than stored.
--
--   art_styles                 the 14 presets (project_id null, inserted at the
--                              foot) and a project's own
--   episode_settings           the Production Settings modal, 1:1 with the episode,
--                              locked_at set by the first successful shoot
--   assets                     stored media by object key - frames, sheets, stills,
--                              references, clips, posters, uploads
--   reels, reel_shots          one clip's worth of a scene and its timed segments;
--                              numeric position so a drag is one row's update
--   shot_description_parts     the description as runs, @mentions structured
--   shot_characters            the Character field, auto or manual
--   storyboard_sheets/frames   one sheet per reel (unique reel_id), a frame row per shot
--   clips                      what Start shooting renders
--   generations                every AI job: reserve, run, settle; the row is the status
--   notes, view_preferences,   the notes popover, View options / Filter & sort per user
--   activity_log               per episode, and one row per mutation
--   scenes.+                   the scene image (still_asset_id, still_state) and the
--                              scene-setup overrides
--
-- The DDL is drizzle-kit's own. The RLS block and the preset rows at the foot
-- are hand-written on the `0016` pattern. Forward-only.

CREATE TYPE "public"."aspect_ratio" AS ENUM('16:9 landscape', '9:16 portrait', '2.39:1 scope');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('frame', 'sheet', 'still', 'reference', 'clip', 'poster', 'upload');--> statement-breakpoint
CREATE TYPE "public"."asset_source" AS ENUM('generated', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."board_view" AS ENUM('grid', 'list');--> statement-breakpoint
CREATE TYPE "public"."camera_motion" AS ENUM('Still', 'Pan', 'Zoom', 'Rotate', 'Tilt', 'Follow', 'Track', 'Dolly', 'Handheld', 'Crane');--> statement-breakpoint
CREATE TYPE "public"."camera_style" AS ENUM('Academy', 'Handheld', 'Steadicam');--> statement-breakpoint
CREATE TYPE "public"."clip_state" AS ENUM('gate', 'queued', 'generating', 'rendered', 'stale', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."continuity" AS ENUM('natural', 'match');--> statement-breakpoint
CREATE TYPE "public"."description_part_kind" AS ENUM('text', 'mention', 'dialogue');--> statement-breakpoint
CREATE TYPE "public"."frame_state" AS ENUM('empty', 'ready', 'queued', 'gen', 'waiting', 'drawn', 'uploaded', 'stale', 'blocked', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."generation_job" AS ENUM('ai_shotlist', 'storyboard_sheet', 'scene_image', 'shot_frame', 'shoot_reel', 'propose_shots', 'character_look');--> statement-breakpoint
CREATE TYPE "public"."generation_state" AS ENUM('queued', 'running', 'succeeded', 'failed', 'refused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."generation_target" AS ENUM('shot', 'reel', 'scene', 'sheet', 'character');--> statement-breakpoint
CREATE TYPE "public"."int_ext" AS ENUM('INT', 'EXT');--> statement-breakpoint
CREATE TYPE "public"."lighting" AS ENUM('Naturalistic', 'Motivated', 'Stylised');--> statement-breakpoint
CREATE TYPE "public"."note_target" AS ENUM('shot', 'scene', 'reel');--> statement-breakpoint
CREATE TYPE "public"."pacing" AS ENUM('Measured', 'Balanced', 'Kinetic');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('none', 'low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."production_type" AS ENUM('Narrative', 'Commercial', 'Documentary');--> statement-breakpoint
CREATE TYPE "public"."reel_status" AS ENUM('writing', 'generating', 'rendered', 'stale');--> statement-breakpoint
CREATE TYPE "public"."sheet_state" AS ENUM('none', 'gen', 'done');--> statement-breakpoint
CREATE TYPE "public"."shot_character_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."shot_status" AS ENUM('to_draw', 'proposed', 'queued', 'generating', 'drawn', 'out_of_date', 'refused');--> statement-breakpoint
CREATE TYPE "public"."shot_type" AS ENUM('Wide angle', 'Medium', 'Close-up', 'Over', 'Point', 'Two shot', 'Tracking', 'Dutch');--> statement-breakpoint
CREATE TYPE "public"."sort_mode" AS ENUM('order', 'longest', 'status');--> statement-breakpoint
CREATE TYPE "public"."status_filter" AS ENUM('all', 'todraw', 'drawn', 'attention');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"source" "asset_source" NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid,
	"verb" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "art_styles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"era" text NOT NULL,
	"reference_films" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"plate_gradient" text DEFAULT '' NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "art_styles_preset_is_global" CHECK (("art_styles"."is_preset") = ("art_styles"."project_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reel_id" uuid NOT NULL,
	"state" "clip_state" DEFAULT 'gate' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"poster_asset_id" uuid,
	"video_asset_id" uuid,
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"generation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_settings" (
	"episode_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"aspect_ratio" "aspect_ratio" NOT NULL,
	"production_type" "production_type" NOT NULL,
	"camera_style" "camera_style" NOT NULL,
	"pacing" "pacing" NOT NULL,
	"lighting" "lighting" NOT NULL,
	"art_style_id" uuid NOT NULL,
	"locked_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"target_type" "generation_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"job" "generation_job" NOT NULL,
	"state" "generation_state" DEFAULT 'queued' NOT NULL,
	"progress" smallint,
	"prompt" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refusal_reason" text,
	"error" text,
	"credits_reserved" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"route" text,
	"source_hash" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generations_progress_percent" CHECK ("generations"."progress" IS NULL OR ("generations"."progress" BETWEEN 0 AND 100)),
	CONSTRAINT "generations_refused_states_reason" CHECK (("generations"."state" <> 'refused') OR "generations"."refusal_reason" IS NOT NULL),
	CONSTRAINT "generations_finished_at_matches_state" CHECK (("generations"."state" IN ('succeeded', 'failed', 'refused', 'cancelled')) = ("generations"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"target_type" "note_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reel_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reel_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"position" numeric(30, 15) NOT NULL,
	"title" text,
	"duration_s" smallint,
	"status" "shot_status",
	"shot_type" "shot_type" DEFAULT 'Medium' NOT NULL,
	"camera_angle" text DEFAULT 'Eye level' NOT NULL,
	"camera_motion" "camera_motion" DEFAULT 'Still' NOT NULL,
	"camera_body" text DEFAULT '' NOT NULL,
	"lens" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"dialogue" text,
	"proposed" boolean DEFAULT false NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"block_reason" text,
	"prop" text,
	"location_id" uuid,
	"int_ext" "int_ext",
	"shoot_date" date,
	"notes" text,
	"assignee_id" uuid,
	"priority" "priority" DEFAULT 'none' NOT NULL,
	"frame_state" "frame_state" DEFAULT 'empty' NOT NULL,
	"frame_asset_id" uuid,
	"frame_progress" smallint,
	"frame_kept" boolean DEFAULT false NOT NULL,
	"take_index" integer[],
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reel_shots_duration_preset" CHECK ("reel_shots"."duration_s" IS NULL OR "reel_shots"."duration_s" = any(ARRAY[2, 3, 4, 5, 8, 10, 15]::smallint[])),
	CONSTRAINT "reel_shots_blocked_states_reason" CHECK ((NOT "reel_shots"."blocked") OR "reel_shots"."block_reason" IS NOT NULL),
	CONSTRAINT "reel_shots_frame_progress_percent" CHECK ("reel_shots"."frame_progress" IS NULL OR ("reel_shots"."frame_progress" BETWEEN 0 AND 100))
);
--> statement-breakpoint
CREATE TABLE "reels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scene_node_id" uuid NOT NULL,
	"name" text NOT NULL,
	"clip_length_s" smallint DEFAULT 15 NOT NULL,
	"continuity" "continuity" DEFAULT 'natural' NOT NULL,
	"status" "reel_status" DEFAULT 'writing' NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"position" numeric(30, 15) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reels_name_not_empty" CHECK (length(btrim("reels"."name")) > 0),
	CONSTRAINT "reels_clip_length_allowed" CHECK ("reels"."clip_length_s" = any(ARRAY[5, 8, 10, 15]::smallint[]))
);
--> statement-breakpoint
CREATE TABLE "shot_characters" (
	"project_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"source" "shot_character_source" NOT NULL,
	CONSTRAINT "shot_characters_shot_id_character_id_pk" PRIMARY KEY("shot_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "shot_description_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "description_part_kind" NOT NULL,
	"text" text NOT NULL,
	"character_id" uuid
);
--> statement-breakpoint
CREATE TABLE "storyboard_frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"sheet_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"camera_note" text DEFAULT '' NOT NULL,
	"time_from_s" integer DEFAULT 0 NOT NULL,
	"time_to_s" integer DEFAULT 0 NOT NULL,
	"asset_id" uuid
);
--> statement-breakpoint
CREATE TABLE "storyboard_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reel_id" uuid NOT NULL,
	"state" "sheet_state" DEFAULT 'none' NOT NULL,
	"asset_id" uuid,
	"progress" smallint,
	"generated_at" timestamp with time zone,
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"art_style_id" uuid,
	"generation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storyboard_sheets_progress_percent" CHECK ("storyboard_sheets"."progress" IS NULL OR ("storyboard_sheets"."progress" BETWEEN 0 AND 100))
);
--> statement-breakpoint
CREATE TABLE "view_preferences" (
	"user_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"view" "board_view" DEFAULT 'grid' NOT NULL,
	"field_visibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_order" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"status_filter" "status_filter" DEFAULT 'all' NOT NULL,
	"unassigned_only" boolean DEFAULT false NOT NULL,
	"sort" "sort_mode" DEFAULT 'order' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_preferences_user_id_episode_id_pk" PRIMARY KEY("user_id","episode_id")
);
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "still_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "still_state" "frame_state" DEFAULT 'empty' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "camera_body" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "lens" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "prop" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "int_ext" "int_ext";--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "shoot_date" date;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "priority" "priority";--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_styles" ADD CONSTRAINT "art_styles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_poster_asset_id_assets_id_fk" FOREIGN KEY ("poster_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_video_asset_id_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_settings" ADD CONSTRAINT "episode_settings_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_settings" ADD CONSTRAINT "episode_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_settings" ADD CONSTRAINT "episode_settings_art_style_id_art_styles_id_fk" FOREIGN KEY ("art_style_id") REFERENCES "public"."art_styles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_settings" ADD CONSTRAINT "episode_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_frame_asset_id_assets_id_fk" FOREIGN KEY ("frame_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reels" ADD CONSTRAINT "reels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_characters" ADD CONSTRAINT "shot_characters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_characters" ADD CONSTRAINT "shot_characters_shot_id_reel_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."reel_shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_characters" ADD CONSTRAINT "shot_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_description_parts" ADD CONSTRAINT "shot_description_parts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_description_parts" ADD CONSTRAINT "shot_description_parts_shot_id_reel_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."reel_shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_description_parts" ADD CONSTRAINT "shot_description_parts_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_frames" ADD CONSTRAINT "storyboard_frames_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_frames" ADD CONSTRAINT "storyboard_frames_sheet_id_storyboard_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."storyboard_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_frames" ADD CONSTRAINT "storyboard_frames_shot_id_reel_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."reel_shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_frames" ADD CONSTRAINT "storyboard_frames_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_sheets" ADD CONSTRAINT "storyboard_sheets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_sheets" ADD CONSTRAINT "storyboard_sheets_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_sheets" ADD CONSTRAINT "storyboard_sheets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_sheets" ADD CONSTRAINT "storyboard_sheets_art_style_id_art_styles_id_fk" FOREIGN KEY ("art_style_id") REFERENCES "public"."art_styles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_sheets" ADD CONSTRAINT "storyboard_sheets_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_project_kind_idx" ON "assets" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "activity_log_project_created_idx" ON "activity_log" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "art_styles_key_key" ON "art_styles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "art_styles_project_idx" ON "art_styles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "clips_reel_created_idx" ON "clips" USING btree ("reel_id","created_at");--> statement-breakpoint
CREATE INDEX "clips_project_idx" ON "clips" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "episode_settings_project_idx" ON "episode_settings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "generations_project_state_idx" ON "generations" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "generations_episode_idx" ON "generations" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "generations_target_idx" ON "generations" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "notes_target_created_idx" ON "notes" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reel_shots_reel_number_key" ON "reel_shots" USING btree ("reel_id","number") WHERE "reel_shots"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reel_shots_reel_position_idx" ON "reel_shots" USING btree ("reel_id","position");--> statement-breakpoint
CREATE INDEX "reel_shots_project_idx" ON "reel_shots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "reels_project_scene_position_idx" ON "reels" USING btree ("project_id","scene_node_id","position");--> statement-breakpoint
CREATE INDEX "shot_characters_project_idx" ON "shot_characters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "shot_description_parts_shot_position_idx" ON "shot_description_parts" USING btree ("shot_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboard_frames_sheet_shot_key" ON "storyboard_frames" USING btree ("sheet_id","shot_id");--> statement-breakpoint
CREATE INDEX "storyboard_frames_sheet_position_idx" ON "storyboard_frames" USING btree ("sheet_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboard_sheets_reel_key" ON "storyboard_sheets" USING btree ("reel_id");--> statement-breakpoint
CREATE INDEX "storyboard_sheets_project_idx" ON "storyboard_sheets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "view_preferences_project_idx" ON "view_preferences" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_still_asset_id_assets_id_fk" FOREIGN KEY ("still_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;

-- ---------------------------------------------------------------------------
-- RLS. Safety net, not mechanism - see 0001's header. The presets
-- (art_styles with a null project_id) are readable by every member and
-- writable by none through RLS; the server's service role seeds them.
-- ---------------------------------------------------------------------------

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY assets_member_all ON public.assets
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.assets FROM anon;
--> statement-breakpoint

ALTER TABLE public.art_styles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY art_styles_member_all ON public.art_styles
  FOR ALL TO authenticated
  USING (project_id IS NULL OR public.folio_is_member(project_id))
  WITH CHECK (project_id IS NOT NULL AND public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.art_styles FROM anon;
--> statement-breakpoint

ALTER TABLE public.episode_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY episode_settings_member_all ON public.episode_settings
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.episode_settings FROM anon;
--> statement-breakpoint

ALTER TABLE public.reels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY reels_member_all ON public.reels
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.reels FROM anon;
--> statement-breakpoint

ALTER TABLE public.reel_shots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY reel_shots_member_all ON public.reel_shots
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.reel_shots FROM anon;
--> statement-breakpoint

ALTER TABLE public.shot_description_parts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY shot_description_parts_member_all ON public.shot_description_parts
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.shot_description_parts FROM anon;
--> statement-breakpoint

ALTER TABLE public.shot_characters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY shot_characters_member_all ON public.shot_characters
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.shot_characters FROM anon;
--> statement-breakpoint

ALTER TABLE public.storyboard_sheets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY storyboard_sheets_member_all ON public.storyboard_sheets
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.storyboard_sheets FROM anon;
--> statement-breakpoint

ALTER TABLE public.storyboard_frames ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY storyboard_frames_member_all ON public.storyboard_frames
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.storyboard_frames FROM anon;
--> statement-breakpoint

ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY clips_member_all ON public.clips
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.clips FROM anon;
--> statement-breakpoint

ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY generations_member_all ON public.generations
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.generations FROM anon;
--> statement-breakpoint

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY notes_member_all ON public.notes
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.notes FROM anon;
--> statement-breakpoint

ALTER TABLE public.view_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY view_preferences_member_all ON public.view_preferences
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.view_preferences FROM anon;
--> statement-breakpoint

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY activity_log_member_all ON public.activity_log
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.activity_log FROM anon;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The 14 art-style presets, as the spec's §6 lists them and the mockup's
-- ART_STYLES describes them. Keyed on `key`, so re-running inserts nothing.
-- ---------------------------------------------------------------------------

INSERT INTO public.art_styles ("key", "name", "era", "reference_films", "description", "plate_gradient", "is_preset", "project_id")
SELECT v.key, v.name, v.era, v.films, v.description, v.gradient, true, NULL
FROM (VALUES
  ('netflix-prestige-drama', 'Netflix Prestige Drama', '2010s – 2020s', ARRAY['Stranger Things', 'Mindhunter', 'The Crown']::text[], 'Restrained, refined, low-saturation contemporary streaming texture, precisely controlled light and shadow, an effortless high-budget cinematic feel throughout.', 'linear-gradient(145deg,#2f353d,#14171b)'),
  ('wes-anderson-symmetrical-fairytale', 'Wes Anderson Symmetrical Fairytale', '2000s – 2010s', ARRAY['The Royal Tenenbaums', 'The Life Aquatic', 'The Grand Budapest Hotel']::text[], 'Obsessive symmetry and pastels, a retro toy-box precision and ritual, flat, cute, meticulous to the last detail.', 'linear-gradient(145deg,#e7b3b6,#cbe1d3)'),
  ('hong-kong-neon-modernism', 'Hong Kong Neon Modernism / Pre-Wong Kar-wai', '1990s – 2000s', ARRAY['Chungking Express', 'Fallen Angels', 'Happy Together']::text[], 'Humid, ambiguous neon reflections, loneliness and desire drifting through suspended time, a lyrical, detached Eastern urban poetry.', 'linear-gradient(145deg,#1e4b46,#7d3a1d)'),
  ('cyberpunk-neon-futurism', 'Cyberpunk / Neon Futurism', '1980s – 1990s', ARRAY['Blade Runner', 'Tron', 'Brazil']::text[], 'A dystopia of high tech and low life, blue-violet neon soaking the rainy night, technological oppression and the suffocating density of the city.', 'linear-gradient(145deg,#1b2050,#5c2272)'),
  ('new-hollywood-modern-american-realism', 'New Hollywood / Modern American Realism', '1970s', ARRAY['The Graduate', 'Taxi Driver', 'Kramer vs. Kramer']::text[], 'Gritty, world-weary American realism, faded warm-yellow film grain, adult social pressure and loneliness.', 'linear-gradient(145deg,#8d6c39,#3a2c1b)'),
  ('spaghetti-western', 'Spaghetti Western', '1960s – 1970s', ARRAY['The Good, the Bad and the Ugly', 'Once Upon a Time in the West', 'Django']::text[], 'Sun-bleached dust and sweat, extreme close-ups against empty horizons, patient standoffs broken by sudden violence.', 'linear-gradient(145deg,#c58a4a,#6b3a23)'),
  ('french-new-wave', 'French New Wave', '1960s', ARRAY['The 400 Blows', 'Breathless', 'Jules and Jim']::text[], 'Light, free, improvised, an anti-polished street-level breath, young and relaxed freshness under natural light.', 'linear-gradient(145deg,#cac7be,#7c898e)'),
  ('italian-neorealism', 'Italian Neorealism', '1940s – 1950s', ARRAY['Rome, Open City', 'Bicycle Thieves', 'Umberto D.']::text[], 'The documentary weight of postwar poverty, rough truth under pure natural light, human warmth carried through hard times.', 'linear-gradient(145deg,#a89b8a,#493f37)'),
  ('film-noir', 'Film Noir', '1940s', ARRAY['Double Indemnity', 'The Third Man', 'The Big Sleep']::text[], 'High-contrast black-and-white fatalism, hard light and heavy shadow slicing the frame, a smoke-wreathed midnight menace.', 'linear-gradient(145deg,#d9d9d9,#0d0d0d)'),
  ('hollywood-golden-age-art-deco', 'Hollywood Golden Age / Art Deco Studio Glamour', '1930s – 1940s', ARRAY['Grand Hotel', 'Top Hat', 'The Wizard of Oz']::text[], 'Lavish symmetrical studio fantasy, gilded geometric ornament, a palatial golden aura under soft star lighting.', 'linear-gradient(145deg,#dcb76c,#67491a)'),
  ('german-expressionism', 'German Expressionism', '1920s', ARRAY['The Cabinet of Dr. Caligari', 'Nosferatu', 'Metropolis']::text[], 'Distorted, tilting nightmare architecture, knife-cut hard shadows, inner fear externalized into imbalance and oppression.', 'linear-gradient(120deg,#9b9b9b,#0f0f0f)'),
  ('a24-contemporary-unease', 'A24 Contemporary Unease', '2010s – Now', ARRAY['Hereditary', 'Moonlight', 'Past Lives']::text[], 'Still, patient frames holding a half-second too long, muted greens and skin-warm lamplight, intimacy carrying a quiet dread.', 'linear-gradient(145deg,#4b5b4f,#1f2329)'),
  ('anime-cinematic-style', 'Anime Cinematic Style', '1980s – Now', ARRAY['Spirited Away', 'Your Name', 'Ghost in the Shell']::text[], 'Clean, translucent cel-shaded light, a bright and poetic emotional space, young, gentle and full of breath.', 'linear-gradient(145deg,#9fd8f2,#d9efc6)'),
  ('graphic-novel-style', 'Graphic Novel Style', '1980s – Now', ARRAY['Spider-Man: Into the Spider-Verse', 'Batman: The Animated Series', 'Sin City']::text[], 'Bold outlines and strong color blocks, the dramatic tension of exaggerated perspective, the hard-edged impact of a single oversized comic cover.', 'linear-gradient(145deg,#df443a,#2a3ea6)')
) AS v("key", "name", "era", "films", "description", "gradient")
ON CONFLICT ("key") DO NOTHING;
