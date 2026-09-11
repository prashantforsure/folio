-- 0002 - the three creation axes on `projects`.
--
-- `kind` used to hold `film | series`. AGENTS.md calls that axis the *project
-- type* (Routing: "`projectType: 'film'` hides the episode segment"), and the
-- `/app/new` brief uses `kind` for `screenwriting | filmmaking`. So:
--
--   kind          project_kind  screenwriting | filmmaking   (new meaning)
--   project_type  project_type  film | series                (the old `kind`)
--   format        script_format hollywood | asian            (an engine input)
--
-- ## Hand-written, and why it differs from what drizzle-kit generated
--
-- drizzle-kit's diff re-typed `kind` in place: cast to text, drop the enum,
-- recreate it with the new values, cast back. That last cast -
-- `"kind"::"project_kind"` - fails on any row holding `film` or `series`, so
-- the generated file is correct only on an empty table. This version renames
-- instead, which carries every existing value across untouched, and then adds
-- the new column. Same end state, same `0002_snapshot.json`; only the path
-- there is data-preserving. `drizzle-kit check` verifies the journal and the
-- snapshots, not the SQL text, so the substitution is invisible to it.
--
-- The two new NOT NULL columns are added with a default and the default is
-- then dropped, so the migration also applies to a table that already has
-- rows. The values chosen for such rows - screenwriting, US Letter - are the
-- only ones any project could have been before this migration existed.

ALTER TYPE "public"."project_kind" RENAME TO "project_type";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "kind" TO "project_type";--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('screenwriting', 'filmmaking');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" "public"."project_kind" DEFAULT 'screenwriting' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "format" "public"."script_format" DEFAULT 'hollywood' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "format" DROP DEFAULT;
