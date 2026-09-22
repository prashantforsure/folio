-- 0029 - two authored columns on `projects` (2026-09-22, the account routes
-- pass). `logline` is the writer's own sentence about the project: the New
-- route's compose box collects it and the project card prints it under the
-- title. `archived_at` is the second soft state the Projects route draws -
-- archived is finished work put out of the way, trashed is deleted and waiting
-- to be restored, and a project can be both. Both nullable, both additive;
-- forward-only, nothing is dropped and no existing row changes.

ALTER TABLE "projects" ADD COLUMN "logline" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "archived_at" timestamp with time zone;
