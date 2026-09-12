-- 0009 - the Locations route: the tree's tombstone and the arc note.
--
-- AGENTS.md, Entity identity: a location has the "same identity model as
-- Characters", is "a tree, not a list", and renaming one "rewrites every
-- scene heading that uses it". The derived half already exists
-- (`location_derivations`, `location_slugline_tallies`, the resolve queue's
-- slugline and structure rows) and `locations` already carries the authored
-- tree (`parent_id`) and `description`. This adds what the route still
-- needed, none of it touched by a derivation pass:
--
--   locations.merged_into       the same tombstone `characters` carries: set
--                               when the writer merged this record into
--                               another, kept so a @mention or a scene still
--                               pointing at the loser can follow it
--   location_arc_notes          one note per location per episode - the
--                               spec's "an arc note per episode", "How this
--                               place changes" on the record view. Keyed by
--                               the episode row, not its slug (ADR 0002)
--
-- The `beats` table the Beats route left behind (removed 2026-09-12) is NOT
-- dropped here: dropping user data is an ask-first item and this migration
-- is the Locations route's alone. `db:generate` will still propose the drop
-- on the next run; it is that phase's migration, not this one's.
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001`, `0005` and `0008`: RLS on, the member-all policy
-- every other authored table has, `anon` gets nothing. Forward-only, as every
-- migration is.

CREATE TABLE "location_arc_notes" (
	"project_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_arc_notes_location_id_episode_id_pk" PRIMARY KEY("location_id","episode_id"),
	CONSTRAINT "location_arc_notes_text_not_empty" CHECK (length(btrim("location_arc_notes"."text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "location_arc_notes" ADD CONSTRAINT "location_arc_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_arc_notes" ADD CONSTRAINT "location_arc_notes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_arc_notes" ADD CONSTRAINT "location_arc_notes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_arc_notes_project_idx" ON "location_arc_notes" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_not_merged_into_self" CHECK ("locations"."merged_into" IS DISTINCT FROM "locations"."id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for location_arc_notes. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.location_arc_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY location_arc_notes_member_all ON public.location_arc_notes
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.location_arc_notes FROM anon;
