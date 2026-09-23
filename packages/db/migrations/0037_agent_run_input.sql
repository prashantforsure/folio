-- 0037 - what a background run was asked to do.
--
-- Roadmap task 4.4, ADR 0003 D4/D5: a background run executes on the worker,
-- one agent_run job at a time, and each job rebuilds the run's context from
-- scratch - the transcript is in assistant_messages, and this column holds the
-- rest: the task's title and brief, the route whose toolset it loads, and
-- whether it reads the episode or the whole project (BackgroundRunInputSchema,
-- @folio/contracts). The story pipeline (task 4.5) stores its own kind here.
--
--   ADD  agent_runs.input  jsonb, null - null for every interactive turn, whose
--                          request carries its context
--
-- Purely additive: every existing row is an interactive turn and gets null.

ALTER TABLE "agent_runs" ADD COLUMN "input" jsonb;
