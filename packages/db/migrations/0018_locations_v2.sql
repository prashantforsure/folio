-- 0018 - the Locations route, v2 pass: the scouting status a writer sets,
-- an address, a photo; and the arc note per episode, gone.
--
-- `docs/ui design/Route - Locations v2.dc.html` (2026-09-16) draws a
-- status on every record - `Pending | Scouted | Locked`, a segmented
-- control in the drawer, a badge on the card, a pill in the sheet - an
-- `Address` line, and a photo tile (`Upload photo` / `Remove`, the
-- portrait's pattern: the storage key on the row, never a URL). None of
-- the three existed.
--
-- The v2 package draws no arc note ("How this place changes", one per
-- location per episode, migration `0009`). Its only readers were the
-- Locations route's own loader, action and record view; nothing else
-- joined the table, so it is dropped here rather than orphaned - the
-- `0015` reasoning, not the `revisions` one.
--
--   ADD   location_status      pending | scouted | locked
--   ADD   locations.status     the writer's, default `pending` - what a pass mints
--   ADD   locations.address    one authored line
--   ADD   locations.photo_key  the storage object's key
--   DROP  location_arc_notes   and its RLS policy, by the cascade
--
-- `locations.scheduled_days` stays: the drawer has no field for it any
-- more, but the pure core's roll-up (`own_shooting_days` / `rollup_shooting_days`)
-- still reads it - "how many days in the chawl". A drop needs a ruling.
--
-- The three additions are AUTHORED: a re-derive touches none of them.
-- Forward-only. The DDL is drizzle-kit's own.

CREATE TYPE "public"."location_status" AS ENUM('pending', 'scouted', 'locked');--> statement-breakpoint
DROP TABLE "location_arc_notes" CASCADE;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "status" "location_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "photo_key" text;
