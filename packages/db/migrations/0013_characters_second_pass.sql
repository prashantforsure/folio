-- 0013 - the Characters route, second pass: the profile a card shows.
--
-- The route was rebuilt to the client's reference on 2026-09-14
-- (`docs/build-decisions.md`, "Characters route, second pass"): a card
-- grid, a relationships graph, a casting table, one modal to create and one
-- drawer to edit. What a writer authors on a record is now what a card
-- shows, and the first pass's profile - drives with sources, voice rules,
-- key lines, arc turns - was DROPPED on the client's explicit ruling. This
-- is the migration AGENTS.md's "write a migration that drops a column" puts
-- behind a question; the question was asked and answered.
--
--   DROP  character_arc_turns   the arc, one turn per row
--   DROP  characters."group"    principal | supporting, and its enum
--   DROP  characters.wants / wants_source / needs / needs_source /
--         flaw / flaw_source / voice_rules / key_lines
--   ADD   characters.color      a `--chip-N` token name, checked against the
--                               ten `packages/ui` names; default chip-1
--   ADD   characters.gender     female | male | non_binary | other; null is
--                               "Not set" and is not printed
--   ADD   characters.appearance notes for the look sheet a later job draws
--   ADD   characters.portrait_key   the storage object's key, never a URL -
--                               the URL is composed at read from env, so the
--                               bucket can move without a data change
--
-- `character_relationships` is kept: it is a derivation read
-- (`repositories/derivation.ts`) and an entity count, and dropping it would
-- widen this change into the derivation reads for no screen. Nothing writes
-- it after this pass; flagged for a later cleanup.
--
-- Generated through drizzle-kit's API in two prompt-free stages (the drops,
-- then the adds), as `0010`/`0011` were, because the CLI wanted a TTY to ask
-- whether `character_gender` was `character_group` renamed. It is not.
-- Forward-only, as every migration is.

DROP TABLE "character_arc_turns" CASCADE;
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "group";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "wants";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "wants_source";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "needs";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "needs_source";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "flaw";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "flaw_source";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "voice_rules";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "key_lines";
--> statement-breakpoint
DROP TYPE "public"."character_group";
--> statement-breakpoint
CREATE TYPE "public"."character_gender" AS ENUM('female', 'male', 'non_binary', 'other');
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "color" text DEFAULT 'chip-1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "gender" character_gender;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "appearance" text;
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "portrait_key" text;
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_color_known" CHECK ("characters"."color" = any(ARRAY['chip-1', 'chip-2', 'chip-3', 'chip-4', 'chip-5', 'chip-6', 'chip-7', 'chip-8', 'chip-9', 'chip-10']::text[]));
