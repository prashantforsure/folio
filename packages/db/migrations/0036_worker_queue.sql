-- 0036 - the worker's queue: claims, heartbeats, attempts, and a wake-up.
--
-- Roadmap task 4.1, ADR 0003 D6 (AGENTS.md ruling R6): the queue is the `jobs`
-- table, claimed with SELECT ... FOR UPDATE SKIP LOCKED and woken by
-- LISTEN/NOTIFY over the session pooler. No Redis, no BullMQ. The table had
-- status, cost, payload, cancellation and error; what a claim needs was missing:
--
--   ADD  job_kind values  agent_run, production_generation
--   ADD  jobs.attempts      int, default 0 - a claim adds one; a job still silent
--                           at its third is failed, not requeued
--   ADD  jobs.claimed_at    when the current claim was taken; also the lease
--                           token a heartbeat and a finish name
--   ADD  jobs.heartbeat_at  the claimant's last sign of life; two minutes without
--                           one and the job is requeued
--   ADD  jobs_queued_idx, jobs_running_heartbeat_idx  partial, for the claim and
--                           the stale sweep - each holds only the rows it reads
--   ADD  folio_jobs_notify() and two triggers - pg_notify('folio_jobs', kind)
--        whenever a row becomes queued, by insert or by update. NOTIFY is
--        delivered on commit, so a worker never wakes for a row it cannot see.
--
-- Purely additive: every existing row gets attempts 0 and two nulls, which is
-- exactly a job nobody has claimed. The trigger is hand-written below the
-- generated statements; drizzle-kit does not model triggers, so db:check and
-- db:generate see no diff for it either way.
--
-- The new enum values are not used in this file. `ALTER TYPE ... ADD VALUE` may
-- run inside the migrator's transaction (Postgres 12+) but a value added there
-- cannot be used until it commits.

ALTER TYPE "public"."job_kind" ADD VALUE 'agent_run';--> statement-breakpoint
ALTER TYPE "public"."job_kind" ADD VALUE 'production_generation';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "jobs_queued_idx" ON "jobs" USING btree ("created_at") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_running_heartbeat_idx" ON "jobs" USING btree ("heartbeat_at") WHERE status = 'running';--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempts_not_negative" CHECK ("jobs"."attempts" >= 0);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."folio_jobs_notify"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_notify('folio_jobs', NEW.kind::text);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "jobs_notify_inserted" AFTER INSERT ON "public"."jobs"
  FOR EACH ROW WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION "public"."folio_jobs_notify"();--> statement-breakpoint
CREATE TRIGGER "jobs_notify_requeued" AFTER UPDATE OF "status" ON "public"."jobs"
  FOR EACH ROW WHEN (NEW.status = 'queued' AND OLD.status IS DISTINCT FROM 'queued')
  EXECUTE FUNCTION "public"."folio_jobs_notify"();
