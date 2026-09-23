-- 0034 - agent runs, and the API's content blocks on assistant messages.
--
-- Roadmap task 2.1, ADR 0003 D3 and D5. The assistant becomes a tool-use loop
-- in Phase 2, and two things it needs have nowhere to live:
--
--   ADD  agent_run_status  queued | running | waiting_for_user | succeeded | failed | cancelled
--   ADD  agent_run_mode    interactive | background
--   ADD  agent_runs        one row per agent task: chat, triggering message, actor,
--                          status, mode, input/output tokens, credit budget (default 0,
--                          D3) and spend, error, timestamps
--   ADD  assistant_messages.content  jsonb, nullable - the API's text / tool_use /
--                          tool_result blocks, replayed on the next turn
--   ADD  assistant_messages.run_id   the run that wrote the turn
--   SWAP assistant_messages_body_not_empty -> assistant_messages_body_or_content:
--        a turn that is only a tool call, or only its result, has no text; it
--        must have a body or a content list, never neither
--
-- Purely additive for every row that exists: each existing message has a body,
-- so it passes the new check, and both new columns are null on it.
--
-- agent_runs' links to the chat, the message and the episode are SET NULL, not
-- CASCADE: the row is also the D3 token meter, and deleting a chat must not hand
-- its writer a fresh daily allowance. The project link cascades, like every
-- tenant row. D14's "two concurrent runs per project" reads this table and is
-- still unenforced - roadmap Phase 4, with background runs.
--
-- RLS block hand-written on the 0033 pattern.

CREATE TYPE "public"."agent_run_mode" AS ENUM('interactive', 'background');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'waiting_for_user', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"chat_id" uuid,
	"message_id" uuid,
	"created_by" uuid NOT NULL,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"mode" "agent_run_mode" DEFAULT 'interactive' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"credit_budget" integer DEFAULT 0 NOT NULL,
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_tokens_nonnegative" CHECK ("agent_runs"."input_tokens" >= 0 and "agent_runs"."output_tokens" >= 0),
	CONSTRAINT "agent_runs_budget" CHECK ("agent_runs"."credit_budget" >= 0 and "agent_runs"."credits_spent" >= 0 and "agent_runs"."credits_spent" <= "agent_runs"."credit_budget")
);
--> statement-breakpoint
ALTER TABLE "assistant_messages" DROP CONSTRAINT "assistant_messages_body_not_empty";--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_chat_id_assistant_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."assistant_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_message_id_assistant_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."assistant_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_project_idx" ON "agent_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "agent_runs_creator_day_idx" ON "agent_runs" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_chat_idx" ON "agent_runs" USING btree ("chat_id");--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_body_or_content" CHECK (length(btrim("assistant_messages"."body")) > 0 or "assistant_messages"."content" is not null);--> statement-breakpoint

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY agent_runs_member_all ON public.agent_runs
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.agent_runs FROM anon;
