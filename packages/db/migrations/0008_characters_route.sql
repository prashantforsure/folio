-- 0008 - the Characters route: the profile a writer authors on a record.
--
-- AGENTS.md, Entity identity: a character is a stable UUID with a name,
-- derived from cues and @mentions, with "profile, arc and relationships
-- authored on top". The derived half already exists (`character_derivations`,
-- `character_cue_tallies`, the resolve queue). This adds the authored half the
-- route edits, all on `characters` and one new table, none of it touched by a
-- derivation pass:
--
--   characters."group"          principal | supporting. The nav's groups are the
--                               writer's; a minted record starts supporting
--   characters.role, .age       "Laundress, second floor" · "38"
--   characters.wants / needs / flaw, each with a _source line - "stated E1
--                               Sc 5", "never stated". Both halves authored:
--                               whether a want is on the page is the writer's
--                               reading of the page
--   characters.voice_rules      how they talk, one rule per entry
--   characters.key_lines        dialogue node ids the writer picked. Not a
--                               foreign key: the text is read from the node,
--                               and a line the script lost is dropped on read
--   character_relationships.shift   how a relationship moves across the draft,
--                               beside `what`; the shared-scene count is derived
--   character_arc_turns         one turn per row, ordered by position, pointing
--                               at a heading node or at nothing. No foreign key
--                               to `nodes`, on the pattern of `scenes`: a
--                               heading brought back by undo finds its turn.
--                               A turn with no present scene is "not on the
--                               page" - read from the join, never stored
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001` and `0005`: RLS on, the member-all policy every other
-- authored table has, `anon` gets nothing. Forward-only, as every migration is.

CREATE TYPE "public"."character_group" AS ENUM('principal', 'supporting');--> statement-breakpoint
CREATE TABLE "character_arc_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"scene_node_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_arc_turns_position_not_negative" CHECK ("character_arc_turns"."position" >= 0),
	CONSTRAINT "character_arc_turns_text_not_empty" CHECK (length(btrim("character_arc_turns"."text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "character_relationships" ADD COLUMN "shift" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "group" character_group DEFAULT 'supporting' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "age" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "wants" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "wants_source" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "needs" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "needs_source" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "flaw" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "flaw_source" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "voice_rules" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "key_lines" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "character_arc_turns" ADD CONSTRAINT "character_arc_turns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_arc_turns" ADD CONSTRAINT "character_arc_turns_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_arc_turns_character_idx" ON "character_arc_turns" USING btree ("character_id","position");--> statement-breakpoint
CREATE INDEX "character_arc_turns_project_idx" ON "character_arc_turns" USING btree ("project_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for character_arc_turns. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.character_arc_turns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY character_arc_turns_member_all ON public.character_arc_turns
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.character_arc_turns FROM anon;
