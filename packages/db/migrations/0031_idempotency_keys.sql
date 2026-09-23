-- 0031 - idempotency keys on the nine tables a create can mint a row in.
--
-- A model that calls a tool in a loop is the first caller this product has
-- that cannot tell its own retry from a second intention. The API's
-- `tool_use` id is the key (ADR 0003 D13), and without one a retried
-- `create_character` makes two characters with the same name and no way to
-- tell which the writer meant.
--
--   ADD  idempotency_key text NULL  on characters, locations, props,
--        research_sources, story_threads, reels, reel_shots, shots, episodes
--   ADD  a partial unique index per table on (project_id, idempotency_key)
--
-- **Nullable, and the index is partial.** Every create the UI makes carries
-- no key, and must keep working: clicking `+ New character` twice means two
-- characters. `NULL` is not equal to `NULL`, so those rows never collide, and
-- the index only holds the rows a retryable caller wrote.
--
-- **Per project, not globally** - `credit_ledger`'s reasoning
-- (`schema/credits.ts`), which is where this pattern comes from: two projects
-- reconciling the same upstream id is legitimate, and a global key would make
-- the second one silently vanish. The repositories treat a conflict as
-- success and return the row that is already there, so a retry is
-- indistinguishable from the first call that succeeded.
--
-- Additive: no column is dropped, no existing row changes, and nothing reads
-- the column until a caller passes a key.

ALTER TABLE "characters" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "props" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "reel_shots" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "reels" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "research_sources" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "story_threads" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "characters_idempotency_key" ON "characters" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_idempotency_key" ON "episodes" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_idempotency_key" ON "locations" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "props_idempotency_key" ON "props" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reel_shots_idempotency_key" ON "reel_shots" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reels_idempotency_key" ON "reels" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "research_sources_idempotency_key" ON "research_sources" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shots_idempotency_key" ON "shots" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "story_threads_idempotency_key" ON "story_threads" USING btree ("project_id","idempotency_key") WHERE idempotency_key is not null;