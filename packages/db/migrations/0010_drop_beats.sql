-- 0010 - drop the orphaned `beats` table.
--
-- The Beats route was removed on 2026-09-12 by a client ruling
-- (`docs/build-decisions.md`, "Beats route removed"). Its Drizzle definition
-- went with it, so the schema has not known this table since; `0009` left the
-- drop for a migration of its own rather than fold it into the Locations
-- route's, and this is that migration. Nothing reads or writes `beats`:
-- `scenes.beats` (the opaque link column, declared in `0000`) is untouched.
--
-- AGENTS.md, When to ask first: a migration that drops a column is asked
-- for. It was - the "Beats route removed" section is the answer - and the
-- drop is kept alone here so it can be held back on its own if that answer
-- changes. `CASCADE` is drizzle-kit's spelling; the only dependents are the
-- table's own policy and grants.

DROP TABLE "beats" CASCADE;
