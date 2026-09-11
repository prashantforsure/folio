-- 0004 - the Revisions route: two more issue counts on a revision, and the
-- two version reasons a restore writes.
--
--   revisions.scenes_touched   scenes with a changed line since the revision
--                              before. A property of the diff between two
--                              frozen snapshots, like lines_added.
--   revisions.page_count       pages as issued. A record of the paper that
--                              was handed out, not a cache of a live count -
--                              see the column's header in schema/history.ts.
--   version_reason             + 'before_restore', + 'restore'. "Restore
--                              creates a new version. It never destroys
--                              history": the first is the document before the
--                              restore, the second is the restored document.
--
-- Both columns default to 0 and keep the default: a revision row cut before
-- either number was computed will never be recut, and 0 is the honest value
-- for "not counted". No backfill - the dev project had no revision row at
-- all when this was applied (2026-09-12), so there was nothing to count.
--
-- ADD VALUE on an enum cannot be used by a later statement in the same
-- transaction on Postgres < 12 and is fine on Supabase's 15+; nothing here
-- writes a row with either value, so the point is moot either way.
--
-- The DDL is drizzle-kit's own. No RLS block: no new table.

ALTER TYPE "public"."version_reason" ADD VALUE 'before_restore';--> statement-breakpoint
ALTER TYPE "public"."version_reason" ADD VALUE 'restore';--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "scenes_touched" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "page_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_issue_counts_not_negative" CHECK ("revisions"."scenes_touched" >= 0 AND "revisions"."page_count" >= 0);
