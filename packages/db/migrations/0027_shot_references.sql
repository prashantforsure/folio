-- 0027 - reel_shots.reference_asset_ids (2026-09-22): the drawer's References
-- row, the client's ruling on its + (upload an image, an asset of kind
-- reference). Not in the spec's shots; an id list because a reference belongs
-- to one shot and goes with it. Additive; forward-only.

ALTER TABLE "reel_shots" ADD COLUMN "reference_asset_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;