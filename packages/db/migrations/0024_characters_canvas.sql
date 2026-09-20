-- 0024 - the Characters fourth pass (2026-09-20): the canvas, and the
-- Relationships graph laper.ai draws, by the client's ruling.
--
--   characters.canvas_x / canvas_y   AUTHORED. Where the canvas left the
--                                    card - world px, whole, both or neither
--                                    (`shots.canvas_x`'s pattern, `0020`).
--                                    Null means "never moved": the canvas
--                                    lays the card out on the first free
--                                    grid cell. Cosmetic; nothing derived
--                                    reads it.
--   character_relationships          AUTHORED, reshaped. One row per
--                                    unordered pair (`character_id <
--                                    other_id` by a check; the primary key
--                                    is the dedupe), two directional labels
--                                    (`a_is` reads "<character_id> is
--                                    <other_id>'s a_is"; `b_is` the other
--                                    way; at least one written) and a free
--                                    `description`. `what` / `shift` (one
--                                    directed row per side, `0013`) go: the
--                                    table was empty - nothing had written
--                                    it since that migration - so this is a
--                                    drop and an add, not a rename, and the
--                                    snapshot agrees with the SQL.
--
-- Ruled 2026-09-20 (ruling 1 of four): the graph replaces the Presence grid
-- and the table takes the shape the graph's labels need. The DDL is
-- drizzle-kit's own, produced through `drizzle-kit/api` in two prompt-free
-- diffs (the drops, then the adds - `generate` asks whether `a_is` is `what`
-- renamed and exits without a TTY), then **reordered by hand** so the adds
-- come first and the drops last, with a fold between them: the dev project
-- turned out to hold one row from the first Characters route (2026-09-12,
-- `Meera Pawar → SURESH KADAM · "Tenant, then opponent"`, stored with
-- `character_id > other_id`), so "the table is empty" was not true and a
-- blind drop would have thrown an authored label away. The fold reads each
-- directed row into the pair shape - `what` becomes `a_is` when the row is
-- already `a < b`, else the row is re-inserted the other way round with
-- `what` as `b_is` (merging into the pair's row if one exists), and `shift`
-- becomes `description` - before `what` / `shift` go. The end state is the
-- snapshot's exactly; only the order and the fold are hand-written. RLS is
-- unchanged: both tables are under the `0001` policies. `character_findings`
-- (`0022`) is untouched and orphaned by the same pass - dropping it is
-- ask-first.

ALTER TABLE "character_relationships" ADD COLUMN "a_is" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD COLUMN "b_is" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "character_relationships" SET "a_is" = btrim("what"), "description" = "shift" WHERE "character_id" < "other_id";--> statement-breakpoint
INSERT INTO "character_relationships" ("project_id", "character_id", "other_id", "what", "a_is", "b_is", "description")
  SELECT "project_id", "other_id", "character_id", "what", '', btrim("what"), "shift" FROM "character_relationships" WHERE "character_id" > "other_id"
  ON CONFLICT ("character_id", "other_id") DO UPDATE SET "b_is" = EXCLUDED."b_is", "description" = COALESCE("character_relationships"."description", EXCLUDED."description"), "updated_at" = now();--> statement-breakpoint
DELETE FROM "character_relationships" WHERE "character_id" > "other_id";--> statement-breakpoint
ALTER TABLE "character_relationships" DROP CONSTRAINT "character_relationships_not_self";--> statement-breakpoint
ALTER TABLE "character_relationships" DROP COLUMN "what";--> statement-breakpoint
ALTER TABLE "character_relationships" DROP COLUMN "shift";--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "canvas_x" integer;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "canvas_y" integer;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_ordered" CHECK ("character_relationships"."character_id" < "character_relationships"."other_id");--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_labelled" CHECK (length(btrim("character_relationships"."a_is")) > 0 OR length(btrim("character_relationships"."b_is")) > 0);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_canvas_position_whole" CHECK (("characters"."canvas_x" IS NULL) = ("characters"."canvas_y" IS NULL));
