-- 0014 - the Production route, backend: reels, the clip a reel renders to,
-- and the take a shot keeps.
--
-- The brief, as ruled for this phase (`docs/build-decisions.md`, "Production
-- route phase, backend"): a reel is a run of one scene's shots that renders
-- together as one clip of a fixed length; every frame generation is kept as
-- a take; a finalized reel renders. The whole UI is being redesigned, so this
-- migration and the server surface over it ship first and the route body
-- follows the design file.
--
--   reels                       AUTHORED. Keyed by `scene_node_id` - the heading
--                               node's id, no foreign key to `nodes` - exactly
--                               as `shots` and `scenes` are. `order_key` is
--                               declared COLLATE "C" by hand, as `shots.order_key`
--                               was in `0006`: drizzle-kit does not track
--                               collation, so this edit produces no drift.
--                               `clip_seconds` is checked against the closed
--                               set `CLIP_SECONDS` (5, 8, 10, 15) - a clip is
--                               what a video model makes and a model makes a
--                               fixed length. `finalized_at` locks the reel's
--                               shots and allows the render. Status is never a
--                               column; it is folded on read
--   reel_renders                AUTHORED. `frame_generations` for a reel: reel to
--                               job, and on failure to the refund entry
--   shots.reel_id               which reel a shot renders in; null until placed.
--                               `set null` on delete - removing a reel keeps its
--                               shots. The order within a reel is the scene's
--                               own `order_key`
--   frame_generations.kept_at   the take the writer chose; at most one per shot
--                               by the partial unique index. The frame read
--                               becomes "kept, else latest", for both routes
--   projects.render_resolution  `720p | 1080p`, project-wide, checked
--   job_kind + 'reel_render'    the second kind. Added inside the migration's
--                               transaction, which Postgres 12+ allows; nothing
--                               in this file uses the value
--
-- No worker exists. A render queued against these rows stays `queued`,
-- visibly, as a frame does.
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001`, `0011` and `0012`: RLS on, the member-all policy every
-- other authored table has, `anon` gets nothing. Forward-only, as every
-- migration is.

ALTER TYPE "public"."job_kind" ADD VALUE 'reel_render';--> statement-breakpoint
CREATE TABLE "reel_renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reel_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"clip_url" text,
	"refund_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scene_node_id" uuid NOT NULL,
	"order_key" text COLLATE "C" NOT NULL,
	"name" text NOT NULL,
	"clip_seconds" integer NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reels_name_not_empty" CHECK (length(btrim("reels"."name")) > 0),
	CONSTRAINT "reels_clip_seconds_allowed" CHECK ("reels"."clip_seconds" = any(ARRAY[5, 8, 10, 15]::integer[]))
);
--> statement-breakpoint
ALTER TABLE "frame_generations" ADD COLUMN "kept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "render_resolution" text DEFAULT '720p' NOT NULL;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "reel_id" uuid;--> statement-breakpoint
ALTER TABLE "reel_renders" ADD CONSTRAINT "reel_renders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_renders" ADD CONSTRAINT "reel_renders_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_renders" ADD CONSTRAINT "reel_renders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_renders" ADD CONSTRAINT "reel_renders_refund_entry_id_credit_ledger_id_fk" FOREIGN KEY ("refund_entry_id") REFERENCES "public"."credit_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reels" ADD CONSTRAINT "reels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reel_renders_job_key" ON "reel_renders" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "reel_renders_reel_created_idx" ON "reel_renders" USING btree ("reel_id","created_at");--> statement-breakpoint
CREATE INDEX "reel_renders_project_idx" ON "reel_renders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "reels_project_scene_order_idx" ON "reels" USING btree ("project_id","scene_node_id","order_key");--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "frame_generations_kept_key" ON "frame_generations" USING btree ("shot_id") WHERE "frame_generations"."kept_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "shots_reel_order_idx" ON "shots" USING btree ("reel_id","order_key");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_render_resolution_allowed" CHECK ("projects"."render_resolution" = any(ARRAY['720p', '1080p']::text[]));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for reels. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.reels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY reels_member_all ON public.reels
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.reels FROM anon;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for reel_renders. Same net.
-- ---------------------------------------------------------------------------

ALTER TABLE public.reel_renders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY reel_renders_member_all ON public.reel_renders
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.reel_renders FROM anon;
