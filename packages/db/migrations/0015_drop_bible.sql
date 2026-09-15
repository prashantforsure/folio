-- 0015 - drop the five bible tables and their three enums.
--
-- The Bible route was removed on 2026-09-15 by a client ruling
-- (`docs/build-decisions.md`, "Bible route removed"): asked directly whether
-- it earned its place, and it did not - everything on it was hand-typed, its
-- only programmatic reader was the rail badge, and its reason for existing
-- (the agent's canon pre-flight, a context gate on `bible_entries.status`)
-- has no agent and no context builder behind it yet. Unlike Revisions and
-- Notes, nothing was left reading these tables once the badge query
-- (`readRailBadges`, `packages/db/src/repositories/workspace.ts`) stopped
-- calling `countOpenCanonConflicts`, so - unlike those - they are dropped
-- here rather than orphaned.
--
-- AGENTS.md, When to ask first: a migration that drops a column is asked
-- for. It was - the "Bible route removed" section is the answer - and the
-- drop is kept alone here, on the `0010_drop_beats` pattern, so it can be
-- held back on its own if that answer changes. `CASCADE` is drizzle-kit's
-- spelling; the only dependents are each table's own policy and grants.

DROP TABLE "bible_entries" CASCADE;--> statement-breakpoint
DROP TABLE "bible_facts" CASCADE;--> statement-breakpoint
DROP TABLE "bible_pitch_fields" CASCADE;--> statement-breakpoint
DROP TABLE "bible_questions" CASCADE;--> statement-breakpoint
DROP TABLE "bible_terms" CASCADE;--> statement-breakpoint
DROP TYPE "public"."bible_entry_kind";--> statement-breakpoint
DROP TYPE "public"."bible_entry_status";--> statement-breakpoint
DROP TYPE "public"."bible_section";
