-- 0021 - the Characters rebuild, phase 3: the script speaks.
--
-- The route reads the script back to the writer as evidence about each
-- person ("Characters rebuild" in `docs/build-decisions.md`). The pure core
-- now counts, per record, what a writer recognises a character by, and the
-- derivation row carries it: dialogue words, speeches (cue nodes),
-- parentheticals, action lines naming them; the first, last and longest
-- line and the introducing action line as `{ nodeId, scene }` JSON (no
-- foreign key - the `scenes.threads` convention, dropped on read when the
-- node is gone); what is said per scene and who is talked to as JSON lists.
-- `scene_derivations.words` is the share denominator (every cue under the
-- heading, resolved or not); `character_cue_tallies.words` is per spelling.
--
--   ADD  character_origin            derived | hand | mention | agent
--   ADD  characters.origin           where the record came from, written once, null before 0021
--   ADD  character_derivations.words / speeches / parens / named_in
--   ADD  character_derivations.first_line / last_line / longest / introduced_at   jsonb
--   ADD  character_derivations.scene_counts / exchanges                           jsonb lists
--   ADD  character_cue_tallies.words
--   ADD  scene_derivations.words
--   ADD  two checks: the new counts are never negative
--
-- `origin` is AUTHORED; everything else is DERIVED CACHE and a re-derive
-- rewrites it. Additive, forward-only, no RLS change (existing tables).
-- Generated with placeholder env values as `0017` was; the DDL is
-- drizzle-kit's own.

CREATE TYPE "public"."character_origin" AS ENUM('derived', 'hand', 'mention', 'agent');--> statement-breakpoint
ALTER TABLE "character_cue_tallies" ADD COLUMN "words" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "words" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "speeches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "parens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "named_in" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "first_line" jsonb;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "last_line" jsonb;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "longest" jsonb;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "introduced_at" jsonb;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "scene_counts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD COLUMN "exchanges" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "origin" character_origin;--> statement-breakpoint
ALTER TABLE "scene_derivations" ADD COLUMN "words" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD CONSTRAINT "character_derivations_voice_counts_not_negative" CHECK ("character_derivations"."words" >= 0 AND "character_derivations"."speeches" >= 0 AND "character_derivations"."parens" >= 0 AND "character_derivations"."named_in" >= 0);--> statement-breakpoint
ALTER TABLE "scene_derivations" ADD CONSTRAINT "scene_derivations_words_not_negative" CHECK ("scene_derivations"."words" >= 0);