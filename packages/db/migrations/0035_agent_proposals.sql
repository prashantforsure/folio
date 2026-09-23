-- 0035 - agent proposals, their operations, run-linked versions, and autonomy.
--
-- Roadmap task 3.1, ADR 0003 D1, D10 and D11. The copilot starts writing in
-- Phase 3, and every write is a proposal the writer reviews first:
--
--   ADD  agent_proposal_status  pending | applied | rejected | stale | failed | partially_applied
--   ADD  agent_op_status        pending | applied | failed | skipped | undone
--   ADD  agent_op_mode          propose | confirm | paid | direct
--   ADD  agent_autonomy         review | auto
--   ADD  agent_proposals        one reviewable group of changes, per run: status, summary,
--                               the base it was planned against (document ids and node
--                               digests, for D10's compare-and-swap), needs_confirmation,
--                               credit_cost, who decided and when
--   ADD  agent_proposal_ops     one tool call of a proposal, in order: tool, args, mode,
--                               idempotency key (the API's tool_use id, unique per project,
--                               D13), status, result, undo, applied_at
--   ADD  versions.run_id        the run a before_agent_run snapshot was taken for, so "undo
--                               this run" finds its snapshots (D11); set null
--   ADD  users.agent_autonomy   review (default) | auto (D1)
--
-- Purely additive: two new tables, two nullable-or-defaulted columns. Every
-- existing user reads back as review, every existing version with no run.
--
-- RLS block hand-written on the 0034 pattern.

CREATE TYPE "public"."agent_autonomy" AS ENUM('review', 'auto');--> statement-breakpoint
CREATE TYPE "public"."agent_op_mode" AS ENUM('propose', 'confirm', 'paid', 'direct');--> statement-breakpoint
CREATE TYPE "public"."agent_op_status" AS ENUM('pending', 'applied', 'failed', 'skipped', 'undone');--> statement-breakpoint
CREATE TYPE "public"."agent_proposal_status" AS ENUM('pending', 'applied', 'rejected', 'stale', 'failed', 'partially_applied');--> statement-breakpoint
CREATE TABLE "agent_proposal_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"mode" "agent_op_mode" NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "agent_op_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"undo" jsonb,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_proposal_ops_seq_nonnegative" CHECK ("agent_proposal_ops"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"episode_id" uuid,
	"status" "agent_proposal_status" DEFAULT 'pending' NOT NULL,
	"summary" text NOT NULL,
	"base" jsonb NOT NULL,
	"needs_confirmation" boolean DEFAULT false NOT NULL,
	"credit_cost" integer,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_proposals_summary_not_empty" CHECK (length(btrim("agent_proposals"."summary")) > 0),
	CONSTRAINT "agent_proposals_cost_nonnegative" CHECK ("agent_proposals"."credit_cost" is null or "agent_proposals"."credit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "agent_autonomy" "agent_autonomy" DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_proposal_ops" ADD CONSTRAINT "agent_proposal_ops_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposal_ops" ADD CONSTRAINT "agent_proposal_ops_proposal_id_agent_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."agent_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proposal_ops_proposal_seq_key" ON "agent_proposal_ops" USING btree ("proposal_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proposal_ops_project_key" ON "agent_proposal_ops" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_proposal_ops_project_idx" ON "agent_proposal_ops" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_proposals_project_idx" ON "agent_proposals" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_run_idx" ON "agent_proposals" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "versions_run_idx" ON "versions" USING btree ("run_id");--> statement-breakpoint

ALTER TABLE public.agent_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.agent_proposal_ops ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY agent_proposals_member_all ON public.agent_proposals
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

CREATE POLICY agent_proposal_ops_member_all ON public.agent_proposal_ops
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.agent_proposals FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.agent_proposal_ops FROM anon;
