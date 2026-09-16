-- 0020 - the Storyboard canvas: where a card sits, and a frame the writer
-- uploaded.
--
-- The Storyboard's canvas view becomes a free surface on 2026-09-17: cards
-- pan, zoom and are dragged anywhere, linked in story order by a thread.
-- A position needs a home, and `shots` had only `order_key`. The client
-- ruled it persisted, per shot, in world px; null means "laid out from
-- `order_key`". Position is cosmetic - the thread, the number and the reel
-- all still read `order_key` - so moving a card reorders nothing.
--
-- The card's `...` menu gains `Upload image`. A generation row needs a job
-- (`frame_generations.job_id`, restrict), and an upload has none, so the
-- upload is a URL on the shot, the way a generation's `frame_url` is one.
-- It wins over a finished, failed or cancelled generation until cleared.
--
--   ADD  shots.canvas_x          world px, null = auto layout
--   ADD  shots.canvas_y          world px, with canvas_x by the check
--   ADD  shots.frame_upload_url  the uploaded frame, on R2
--   ADD  shots_canvas_position_whole   both or neither
--
-- AUTHORED, additive, forward-only. No RLS change: the columns sit on a
-- table already under `shots`' policies. The DDL is drizzle-kit's own.

ALTER TABLE "shots" ADD COLUMN "canvas_x" integer;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "canvas_y" integer;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "frame_upload_url" text;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_canvas_position_whole" CHECK (("shots"."canvas_x" IS NULL) = ("shots"."canvas_y" IS NULL));