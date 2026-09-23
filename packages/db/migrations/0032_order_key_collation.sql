-- 0032 - the durable half of the order-key fix: COLLATE "C" on the column.
--
-- ADR 0003 D9, and the incident `src/order.ts:64-85` records. An order key is
-- a byte string compared lexicographically, and under a locale collation it is
-- not. `nodes.order_key` is plain `text` (migration `0000`), so it took the
-- database's default - `en_US.UTF-8` on the dev project, which is locale
-- aware, case folding, `k` before `U`. A 2,937-node feature came back starting
-- at its 3,000th key, derivation numbered the scenes in that order, the
-- measurement record numbered them in the real one, and 172 of 220 cards
-- disagreed with themselves.
--
-- The read-side half shipped with that incident: `byOrderKey` spells
-- `COLLATE "C"` into every `ORDER BY` (`src/order.ts:86`). This is the half it
-- named and could not do - "a forward migration putting the collation on the
-- column itself, so an index or an ad-hoc query cannot fall back to the
-- locale". An agent composing order keys in a loop is what made waiting for it
-- untenable.
--
--   ALTER  nodes.order_key  text -> text COLLATE "C"
--   ALTER  shots.order_key  restated (already COLLATE "C" since 0006)
--   REBUILD nodes_document_order_key, under the new collation
--
-- **The index is dropped and recreated around the ALTER**, in one transaction.
-- `ALTER COLUMN ... TYPE` rebuilds dependent indexes by itself, and the
-- explicit pair is here anyway: this is the index whose ordering was wrong, a
-- reader should be able to see that it was rebuilt rather than infer it, and
-- one rebuild is cheaper than the ALTER's plus a REINDEX. Nothing outside this
-- transaction ever sees the table without its unique index.
--
-- `shots.order_key` was declared `COLLATE "C"` by hand in `0006` and this
-- restates it, so the column's collation is the same whichever migration a
-- database started from. On a database that already has it, it is a rewrite
-- that changes no value.
--
-- **No value changes.** The keys are the base-62 alphabet the pure core
-- produces; what changes is the order the database puts them in, which is now
-- the order every read already asked for. `apps/web/tests/order-collation.test.ts`
-- holds a fixture document's sequence against byte order.
--
-- Drizzle's `text()` builder cannot express a collation, so this is a custom
-- migration and `schema/columns.ts` says so above `orderKeyColumn`. `db:check`
-- and `db:generate` see no diff either way - the schema and the database agree
-- on everything drizzle can model.

DROP INDEX IF EXISTS "nodes_document_order_key";--> statement-breakpoint
ALTER TABLE "nodes" ALTER COLUMN "order_key" TYPE text COLLATE "C";--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_document_order_key" ON "nodes" USING btree ("document_id","order_key");--> statement-breakpoint
ALTER TABLE "shots" ALTER COLUMN "order_key" TYPE text COLLATE "C";
