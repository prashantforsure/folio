-- 0017 - the Characters route, v2 pass: the status a writer sets, and the
-- two lines the drawer authors.
--
-- `docs/ui design/Route - Characters v2.dc.html` (2026-09-16) draws a
-- status on every record - `Draft | Defined | Locked`, a segmented control
-- in the drawer, a badge on the card, a pill in the sheet - and `Wants` /
-- `Needs` in the drawer. Neither existed: `0013` dropped the first
-- profile's `wants` / `needs` (with their sources, the flaw, the arc turns
-- and the `group`) on the client's ruling. The v2 package brings the two
-- lines back, alone; the sources and the flaw stay gone, and
-- `Principal | Supporting` stays computed rather than a column
-- (`apps/web/lib/characters/cast.ts`).
--
--   ADD  character_status   draft | defined | locked
--   ADD  characters.status  the writer's, default `draft` - what a pass mints
--   ADD  characters.wants   one authored line
--   ADD  characters.needs   one authored line
--
-- All three AUTHORED: a re-derive touches none of them, which the table
-- split guarantees (`schema/derived.ts`). Additive, forward-only. The DDL
-- is drizzle-kit's own.

CREATE TYPE "public"."character_status" AS ENUM('draft', 'defined', 'locked');--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "status" character_status DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "wants" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "needs" text;
