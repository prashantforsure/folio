-- 0039 - the production pipeline's stages, and a location plate.
--
-- Roadmap task 5.1, ADR 0003 D3/D4/D5: a script_to_production run carries an
-- episode into Production over several jobs and checkpoints, storing where it
-- is in agent_run_stages as the story pipeline does (0038). And a shoot needs
-- each scene's location photo, which until now only an upload could supply:
-- the client asked for a plate drawn from the location's description
-- (2026-09-24), priced provisionally at 40 credits (GENERATION_COSTS; the price
-- is theirs to rule - open decision 14).
--
--   ALTER  generation_job     + location_plate
--   ALTER  generation_target  + location
--   ALTER  story_stage        + production_setup, production_shots,
--                               production_plates, production_images,
--                               production_shoot
--
-- Values only. None is used as a literal here or needs to be: a value added by
-- ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it, and
-- drizzle runs a batch of migrations as one (packages/db/CLAUDE.md, 0038's
-- trap).

ALTER TYPE "public"."generation_job" ADD VALUE 'location_plate';--> statement-breakpoint
ALTER TYPE "public"."generation_target" ADD VALUE 'location';--> statement-breakpoint
ALTER TYPE "public"."story_stage" ADD VALUE 'production_setup';--> statement-breakpoint
ALTER TYPE "public"."story_stage" ADD VALUE 'production_shots';--> statement-breakpoint
ALTER TYPE "public"."story_stage" ADD VALUE 'production_plates';--> statement-breakpoint
ALTER TYPE "public"."story_stage" ADD VALUE 'production_images';--> statement-breakpoint
ALTER TYPE "public"."story_stage" ADD VALUE 'production_shoot';