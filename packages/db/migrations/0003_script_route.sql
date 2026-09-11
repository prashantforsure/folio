-- 0003 - the Script route: the pagination preference finds its home, and the
-- title page gets a table.
--
-- Two rulings the client made on 2026-09-11 (`docs/build-decisions.md`, Script
-- route phase):
--
--   projects.page_mode        page_mode  paged | continuous   default 'paged'
--   projects.live_repaginate  boolean                         default false
--   title_pages               one per episode, Fountain's title-page keys as
--                             nullable text columns; AUTHORED, member-writable
--
-- The two columns keep their defaults on purpose - unlike `0002`, where a
-- default was dropped after backfill. A project row must always have a
-- pagination preference, and the default *is* the preference a new project
-- has (`DEFAULT_PROJECT_PAGINATION` in `apps/web/lib/state/project-preferences.ts`).
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001`: a new table with RLS enabled and no policy denies
-- everything to non-owners, and the member-all policy is the one every other
-- authored table has. `anon` gets nothing, as everywhere.

CREATE TABLE "title_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"title" text,
	"credit" text,
	"author" text,
	"source" text,
	"draft_date" text,
	"contact" text,
	"copyright" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "page_mode" "page_mode" DEFAULT 'paged' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "live_repaginate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "title_pages" ADD CONSTRAINT "title_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_pages" ADD CONSTRAINT "title_pages_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "title_pages_episode_key" ON "title_pages" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "title_pages_project_idx" ON "title_pages" USING btree ("project_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for title_pages. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.title_pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY title_pages_member_all ON public.title_pages
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.title_pages FROM anon;
