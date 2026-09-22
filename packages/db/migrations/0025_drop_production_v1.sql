-- 0025 - drop the Production v1 tables and columns (2026-09-22).
--
-- The route is rebuilt to `docs/production/production.md` (v12) on its own
-- tables (`0026`). What `0014` added for the first backend pass goes here, on
-- the client's instruction ("remove the Production implementation it
-- replaces ... dead enums and columns"):
--
--   reels, reel_renders              dropped outright - their only readers were
--                                    the v1 route's, the way `0015` went
--   shots.reel_id                    the Storyboard's shots no longer belong to
--                                    a reel; the lock that came with it left the
--                                    repository in the same change
--   frame_generations.kept_at        the kept take was a v1 idea; the frame read
--                                    is "latest" again
--   projects.render_resolution       v12 puts the aspect ratio on the episode's
--                                    settings instead
--   job_kind - 'reel_render'         Postgres cannot drop an enum value, so
--                                    drizzle-kit recreates the type. The two
--                                    hand-written statements before it release
--                                    any credits a v1 render still holds (the
--                                    ledger is append-only: a `release` row, never
--                                    a delete) and remove the rows the cast would
--                                    refuse. `frame_generations` never pointed at a
--                                    render job, so nothing restricts the delete.
--
-- Forward-only, as every migration is. The DDL is drizzle-kit's own.

INSERT INTO "credit_ledger" ("project_id", "kind", "delta", "job_id", "idempotency_key", "reason")
SELECT l.project_id, 'release', -l.delta, l.job_id, 'release:job:' || l.job_id::text, 'Production v1 removed (0025)'
FROM "credit_ledger" AS l
JOIN "jobs" AS j ON j.id = l.job_id
WHERE l.kind = 'reserve' AND j.kind = 'reel_render'
  AND NOT EXISTS (
    SELECT 1 FROM "credit_ledger" AS c
    WHERE c.project_id = l.project_id AND c.job_id = l.job_id AND c.kind IN ('release', 'spend')
  )
ON CONFLICT ("project_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
ALTER TABLE "reel_renders" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reels" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "reel_renders" CASCADE;--> statement-breakpoint
DROP TABLE "reels" CASCADE;--> statement-breakpoint
DELETE FROM "jobs" WHERE "kind" = 'reel_render';--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_render_resolution_allowed";--> statement-breakpoint
ALTER TABLE "shots" DROP CONSTRAINT IF EXISTS "shots_reel_id_reels_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."job_kind";--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('frame_generation');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "kind" SET DATA TYPE "public"."job_kind" USING "kind"::"public"."job_kind";--> statement-breakpoint
DROP INDEX "frame_generations_kept_key";--> statement-breakpoint
DROP INDEX "shots_reel_order_idx";--> statement-breakpoint
ALTER TABLE "frame_generations" DROP COLUMN "kept_at";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "render_resolution";--> statement-breakpoint
ALTER TABLE "shots" DROP COLUMN "reel_id";