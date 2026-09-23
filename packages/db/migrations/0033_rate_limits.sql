-- 0033 - rate limits: one fixed-window counter per user, project and bucket.
--
-- ADR 0003 D14. No rate limiting of any kind existed before this - the only
-- `429` in the repository was *reading* Supabase's own limit on auth. A model
-- that can call a tool in a loop is the first thing in this product that can
-- generate load without a human clicking, so the limits ship with it rather
-- than after the first incident:
--
--   60  assistant requests  per user per project per hour
--   30  generate actions    per user per project per hour
--
-- D14's third limit - two concurrent agent runs per project - is deliberately
-- absent: it is not a window but a count of live rows in `agent_runs`, and it
-- arrives with that table.
--
--   ADD  rate_limit_bucket  assistant | generate
--   ADD  rate_limits        (project_id, user_id, bucket, window_start) PK, count
--
-- Postgres and not Redis, for D6's reasons one table over: a second store
-- beside Postgres is a dependency decision AGENTS.md puts behind a question,
-- and a fixed window is a counting query. Approximate at the boundary, exact
-- enough for limits set well above real use.
--
-- `window_start` is `date_trunc('hour', now())` and part of the key, so a new
-- hour is a new row rather than a reset, and two web processes with different
-- clocks agree on which window they are in. Old rows are dead weight rather
-- than a correctness problem; a retention sweep is a later pass's, alongside
-- `activity_log`'s.
--
-- RLS block hand-written on the `0022` pattern.

CREATE TYPE "public"."rate_limit_bucket" AS ENUM('assistant', 'generate');--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"bucket" "rate_limit_bucket" NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_project_id_user_id_bucket_window_start_pk" PRIMARY KEY("project_id","user_id","bucket","window_start")
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY rate_limits_member_all ON public.rate_limits
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.rate_limits FROM anon;
