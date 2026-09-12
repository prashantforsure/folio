-- 0011 - the Timeline route: story threads, and story time on a scene.
--
-- The brief: "Story order versus what actually happened, across all
-- episodes. Two authored things power it." Both are authored, neither is
-- parsed, and a derivation pass touches neither:
--
--   story_threads               a named, coloured storyline. The scenes it runs
--                               through are `scenes.threads` - the column
--                               declared opaque in `0000` for exactly this, now
--                               holding thread ids as text in the writer's
--                               order, the first being the grid row a scene's
--                               card sits in. No foreign key from scene to
--                               thread: a deleted thread is removed from every
--                               scene by the repository in one statement, and a
--                               stale id is dropped on read (`characters.
--                               key_lines` has the same rule). `colour` is a
--                               closed enum, each value a themed token in
--                               `packages/ui`, so a hex is still written in one
--                               place
--   scenes.story_day            any integer; Day 1 first by convention
--   scenes.story_clock          HH:MM, 24-hour, checked; text because that shape
--                               sorts as a clock does. Checked to need a day
--   scenes.flashback            the writer's flag: this jump backwards is meant
--
-- `scenes.story_time` - the opaque text column of the same age as `threads` -
-- has no writer and is not dropped; dropping a column is asked for.
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001`, `0005` and `0008`: RLS on, the member-all policy every
-- other authored table has, `anon` gets nothing. Forward-only, as every
-- migration is.

CREATE TYPE "public"."story_thread_colour" AS ENUM('terracotta', 'slate', 'moss', 'ochre', 'violet', 'teal');
--> statement-breakpoint
CREATE TABLE "story_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"colour" "story_thread_colour" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_threads_name_not_empty" CHECK (length(btrim("story_threads"."name")) > 0),
	CONSTRAINT "story_threads_position_not_negative" CHECK ("story_threads"."position" >= 0)
);

--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "story_day" integer;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "story_clock" text;
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "flashback" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "story_threads" ADD CONSTRAINT "story_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "story_threads_project_position_idx" ON "story_threads" USING btree ("project_id","position");
--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_story_clock_shape" CHECK ("scenes"."story_clock" IS NULL OR "scenes"."story_clock" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_story_clock_needs_day" CHECK ("scenes"."story_clock" IS NULL OR "scenes"."story_day" IS NOT NULL);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for story_threads. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.story_threads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY story_threads_member_all ON public.story_threads
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.story_threads FROM anon;
