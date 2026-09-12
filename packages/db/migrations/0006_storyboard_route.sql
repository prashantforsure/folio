-- 0006 - the Storyboard route: shots, jobs, and the generation rows between them.
--
-- Three authored tables. `schema/storyboard.ts` carries the reasoning; the
-- short form:
--
--   shots              a scene does not say how it is shot. Keyed by the
--                      heading node's id like `scenes` (no FK to `nodes`, so a
--                      heading brought back by undo finds its shots), ordered
--                      by a fractional `order_key`, described in inline
--                      content whose @mentions are record ids. `origin` +
--                      `state` are "proposed, then accepted"; a typed shot is
--                      born accepted (checked).
--   jobs               the job row IS the status - AGENTS.md's exception
--                      table drives `production.state` "from the job row".
--                      `cost` is what the ledger's `reserve` entry for the
--                      same `job_id` holds. No queue library exists yet; a
--                      row written here is `queued` until a worker exists.
--   frame_generations  shot -> job, and on failure -> the refund entry. One
--                      per job (unique). A shot's frame is its latest row
--                      here read with its job; nothing on `shots` mirrors it.
--
-- `credit_ledger.job_id` still has no foreign key to `jobs`: adding a
-- constraint to the append-only money table is a ledger change and is behind
-- a question (AGENTS.md, When to ask first). It resolves by convention.
--
-- `shots.order_key` is declared COLLATE "C" by hand: the base-62 alphabet in
-- `order.ts` sorts correctly only under that collation, and the Scenes phase
-- found `nodes.order_key` misordered under the dev project's `en_US.UTF-8`
-- default (read-side `byOrderKey` is the workaround there). A new column can
-- carry the right collation from birth. drizzle-kit does not track collation
-- in its snapshot, so this hand edit produces no drift on the next generate.
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001`, `0003` and `0005`: RLS on, the member-all policy
-- every other authored table has, `anon` gets nothing.

CREATE TYPE "public"."camera_angle" AS ENUM('eye_level', 'low', 'high', 'dutch', 'overhead', 'pov');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('frame_generation');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'finished', 'failed', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shot_movement" AS ENUM('static', 'handheld', 'pan', 'tilt', 'dolly', 'track', 'crane', 'steadicam', 'zoom');--> statement-breakpoint
CREATE TYPE "public"."shot_origin" AS ENUM('typed', 'auto_board');--> statement-breakpoint
CREATE TYPE "public"."shot_size" AS ENUM('ews', 'ws', 'mws', 'ms', 'mcu', 'cu', 'ecu', 'ots', 'insert');--> statement-breakpoint
CREATE TYPE "public"."shot_state" AS ENUM('proposed', 'accepted');--> statement-breakpoint
CREATE TABLE "frame_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"frame_url" text,
	"refund_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"cost" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"error" text,
	"blocked_reason" text,
	CONSTRAINT "jobs_cost_not_negative" CHECK ("jobs"."cost" >= 0),
	CONSTRAINT "jobs_blocked_states_reason" CHECK (("jobs"."status" = 'blocked') = ("jobs"."blocked_reason" IS NOT NULL)),
	CONSTRAINT "jobs_finished_at_matches_status" CHECK (("jobs"."status" IN ('finished', 'failed', 'blocked', 'cancelled')) = ("jobs"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scene_node_id" uuid NOT NULL,
	"order_key" text COLLATE "C" NOT NULL,
	"size" "shot_size" NOT NULL,
	"movement" "shot_movement" NOT NULL,
	"angle" "camera_angle" NOT NULL,
	"lens_mm" integer,
	"duration_seconds" integer,
	"description" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" "shot_origin" NOT NULL,
	"state" "shot_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shots_lens_and_duration_sane" CHECK (("shots"."lens_mm" IS NULL OR "shots"."lens_mm" > 0) AND ("shots"."duration_seconds" IS NULL OR "shots"."duration_seconds" >= 0)),
	CONSTRAINT "shots_typed_is_accepted" CHECK ("shots"."origin" <> 'typed' OR "shots"."state" = 'accepted')
);
--> statement-breakpoint
ALTER TABLE "frame_generations" ADD CONSTRAINT "frame_generations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_generations" ADD CONSTRAINT "frame_generations_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_generations" ADD CONSTRAINT "frame_generations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_generations" ADD CONSTRAINT "frame_generations_refund_entry_id_credit_ledger_id_fk" FOREIGN KEY ("refund_entry_id") REFERENCES "public"."credit_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "frame_generations_job_key" ON "frame_generations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "frame_generations_shot_created_idx" ON "frame_generations" USING btree ("shot_id","created_at");--> statement-breakpoint
CREATE INDEX "frame_generations_project_idx" ON "frame_generations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jobs_project_status_idx" ON "jobs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "shots_project_scene_order_idx" ON "shots" USING btree ("project_id","scene_node_id","order_key");

-- ---------------------------------------------------------------------------
-- RLS for the three tables. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.shots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.frame_generations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY shots_member_all ON public.shots
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

CREATE POLICY jobs_member_all ON public.jobs
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

CREATE POLICY frame_generations_member_all ON public.frame_generations
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.shots FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.jobs FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.frame_generations FROM anon;
