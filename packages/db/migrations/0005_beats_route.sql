-- 0005 - the Beats route: what a writer hangs on a beat block.
--
-- A beat is an outline `beat` block (`@folio/script`'s `beats.ts`); its number
-- is its ordinal and its name and one-line are its text, none of it stored
-- twice. This table carries the rest, keyed by the block's node id on the
-- pattern of `scenes.scene_node_id` - no foreign key to `nodes`, so a block
-- brought back by undo finds its timing where it left it:
--
--   beats.duration_minutes   whole minutes, or null until given
--   beats.placed_at_minute   start minute on the episode timeline; NULL is
--                            *unplaced*. One column, not a status plus a
--                            position that could disagree
--   beats.canvas_x / _y      where the card was left on the unplaced canvas,
--                            a pair or nothing (checked)
--
-- The scene links a beat names live on the scene side already:
-- `scenes.beats text[]` was declared for "beat links" and carried through
-- every re-derive; the Beats route writes beat node ids into it. No new
-- column and no join table for that.
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001` and `0003`: RLS on, the member-all policy every other
-- authored table has, `anon` gets nothing.

CREATE TABLE "beats" (
	"beat_node_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"duration_minutes" integer,
	"placed_at_minute" integer,
	"canvas_x" integer,
	"canvas_y" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beats_minutes_not_negative" CHECK (("beats"."duration_minutes" IS NULL OR "beats"."duration_minutes" >= 0) AND ("beats"."placed_at_minute" IS NULL OR "beats"."placed_at_minute" >= 0)),
	CONSTRAINT "beats_canvas_spot_is_a_pair" CHECK (("beats"."canvas_x" IS NULL) = ("beats"."canvas_y" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "beats" ADD CONSTRAINT "beats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beats_project_idx" ON "beats" USING btree ("project_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for beats. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.beats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY beats_member_all ON public.beats
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.beats FROM anon;
