-- 0038 - what a story-to-script run has made so far.
--
-- Roadmap task 4.5, ADR 0003 D4/D5: a story_to_script run turns a story into
-- a draft in six stages (expand, bible, outline, scenes, draft, finish), over
-- several jobs and checkpoints. Each stage's output is parsed with its
-- contract (StageOutputSchemas, @folio/contracts) and stored here, one row per
-- run and stage, so a paused or crashed run picks up at the stage it reached
-- rather than asking the model again.
--
--   ADD  story_stage, story_stage_status  the six stages; ready | waiting | approved
--   ADD  agent_run_stages  written by the run; cascades with the run and the
--                          project; unique per (run, stage)
--   RLS  member-only, the 0034 / 0035 pattern (hand-written below the
--        generated statements)
--
-- Purely additive. Not the script and never read as it: the draft is
-- proposals until the writer applies them.

CREATE TYPE "public"."story_stage" AS ENUM('expand', 'bible', 'outline', 'scenes', 'draft', 'finish');--> statement-breakpoint
CREATE TYPE "public"."story_stage_status" AS ENUM('ready', 'waiting', 'approved');--> statement-breakpoint
CREATE TABLE "agent_run_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "story_stage" NOT NULL,
	"status" "story_stage_status" DEFAULT 'ready' NOT NULL,
	"output" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run_stages" ADD CONSTRAINT "agent_run_stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_stages" ADD CONSTRAINT "agent_run_stages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_stages_run_stage_key" ON "agent_run_stages" USING btree ("run_id","stage");--> statement-breakpoint
CREATE INDEX "agent_run_stages_project_idx" ON "agent_run_stages" USING btree ("project_id");--> statement-breakpoint

ALTER TABLE public.agent_run_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY agent_run_stages_member_all ON public.agent_run_stages
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.agent_run_stages FROM anon;
