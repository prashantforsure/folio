-- 0012 - the Bible route: five authored tables.
--
-- The brief: "What is true in this world, and what the draft is
-- contradicting. Authored entries whose facts cite derived scenes." All
-- five tables are authored; a derivation pass touches none of them, and
-- nothing computable is stored - a glossary term's use count and a cite's
-- current scene number are read off the node list at render:
--
--   bible_entries               sectioned (the four sections are an enum in the
--                               brief's order), kinded (`rules` or the one
--                               `pitch` per project - a partial unique index),
--                               and statused. `status` is the first of the two
--                               context gates: `canon` is checked against every
--                               draft and readable by lenses, `draft` is neither
--                               until promoted, `retired` is ignored. It defaults
--                               to `draft`: nothing is canon until marked
--   bible_facts                 numbered rules. `cites` is heading node ids with
--                               no foreign key (the `key_lines` rule: a scene the
--                               script has lost is dropped on read). A recorded
--                               conflict is a scene id and a note together -
--                               checked to be both or neither
--   bible_questions             open questions, each with an author (a users row)
--   bible_pitch_fields          the Pitch's ordered key/value fields, kept apart
--                               from the facts by being another table
--   bible_terms                 glossary terms, unique by spelling case-folded.
--                               The use count and first-use scene are computed
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001`, `0008` and `0011`: RLS on, the member-all policy every
-- other authored table has, `anon` gets nothing. Forward-only, as every
-- migration is.

CREATE TYPE "public"."bible_entry_kind" AS ENUM('rules', 'pitch');--> statement-breakpoint
CREATE TYPE "public"."bible_entry_status" AS ENUM('draft', 'canon', 'retired');--> statement-breakpoint
CREATE TYPE "public"."bible_section" AS ENUM('premise', 'how_things_work', 'history', 'themes');--> statement-breakpoint
CREATE TABLE "bible_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"section" "bible_section" NOT NULL,
	"kind" "bible_entry_kind" DEFAULT 'rules' NOT NULL,
	"status" "bible_entry_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"lede" text,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bible_entries_title_not_empty" CHECK (length(btrim("bible_entries"."title")) > 0),
	CONSTRAINT "bible_entries_position_not_negative" CHECK ("bible_entries"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bible_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"cites" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"conflict_scene_node_id" uuid,
	"conflict_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bible_facts_text_not_empty" CHECK (length(btrim("bible_facts"."text")) > 0),
	CONSTRAINT "bible_facts_position_not_negative" CHECK ("bible_facts"."position" >= 0),
	CONSTRAINT "bible_facts_conflict_whole" CHECK (("bible_facts"."conflict_scene_node_id" IS NULL) = ("bible_facts"."conflict_note" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "bible_pitch_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bible_pitch_fields_key_not_empty" CHECK (length(btrim("bible_pitch_fields"."key")) > 0),
	CONSTRAINT "bible_pitch_fields_position_not_negative" CHECK ("bible_pitch_fields"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bible_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"author_id" uuid NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bible_questions_text_not_empty" CHECK (length(btrim("bible_questions"."text")) > 0),
	CONSTRAINT "bible_questions_position_not_negative" CHECK ("bible_questions"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bible_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"term" text NOT NULL,
	"definition" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bible_terms_term_not_empty" CHECK (length(btrim("bible_terms"."term")) > 0)
);
--> statement-breakpoint
ALTER TABLE "bible_entries" ADD CONSTRAINT "bible_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_facts" ADD CONSTRAINT "bible_facts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_facts" ADD CONSTRAINT "bible_facts_entry_id_bible_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."bible_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_pitch_fields" ADD CONSTRAINT "bible_pitch_fields_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_pitch_fields" ADD CONSTRAINT "bible_pitch_fields_entry_id_bible_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."bible_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_questions" ADD CONSTRAINT "bible_questions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_questions" ADD CONSTRAINT "bible_questions_entry_id_bible_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."bible_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_questions" ADD CONSTRAINT "bible_questions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_terms" ADD CONSTRAINT "bible_terms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bible_entries_project_section_position_idx" ON "bible_entries" USING btree ("project_id","section","position");--> statement-breakpoint
CREATE UNIQUE INDEX "bible_entries_one_pitch_idx" ON "bible_entries" USING btree ("project_id") WHERE kind = 'pitch';--> statement-breakpoint
CREATE INDEX "bible_facts_entry_position_idx" ON "bible_facts" USING btree ("entry_id","position");--> statement-breakpoint
CREATE INDEX "bible_facts_project_idx" ON "bible_facts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "bible_pitch_fields_entry_position_idx" ON "bible_pitch_fields" USING btree ("entry_id","position");--> statement-breakpoint
CREATE INDEX "bible_pitch_fields_project_idx" ON "bible_pitch_fields" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "bible_questions_entry_position_idx" ON "bible_questions" USING btree ("entry_id","position");--> statement-breakpoint
CREATE INDEX "bible_questions_project_idx" ON "bible_questions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bible_terms_project_term_key" ON "bible_terms" USING btree ("project_id",lower("term"));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for the five bible tables. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.bible_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.bible_facts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.bible_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.bible_pitch_fields ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.bible_terms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY bible_entries_member_all ON public.bible_entries
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint
CREATE POLICY bible_facts_member_all ON public.bible_facts
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint
CREATE POLICY bible_questions_member_all ON public.bible_questions
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint
CREATE POLICY bible_pitch_fields_member_all ON public.bible_pitch_fields
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint
CREATE POLICY bible_terms_member_all ON public.bible_terms
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.bible_entries FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.bible_facts FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.bible_questions FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.bible_pitch_fields FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.bible_terms FROM anon;
