-- 0028 - reel_shots.duration_s takes any whole second 1–15 (2026-09-22). The
-- spec's duration menu offers presets (2 3 4 5 8 10 15) but its timing bar
-- "pointer-drag[s] to retime … rounded to whole seconds", so 6 s and 7 s are
-- shots a writer can make; the preset check refused them. Forward-only.

ALTER TABLE "reel_shots" DROP CONSTRAINT "reel_shots_duration_preset";--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_duration_range" CHECK ("reel_shots"."duration_s" IS NULL OR ("reel_shots"."duration_s" BETWEEN 1 AND 15));