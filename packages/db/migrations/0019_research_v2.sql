-- 0019 - the v2 redesign, Research route: collections, sources, clips and
-- filings. `docs/ui design/Route - Research v2.dc.html` (2026-09-16).
--
-- The first tables under the route. `schema/index.ts` listed "research
-- sources" as deliberately absent until this pass; all four are AUTHORED -
-- a source is brought in from outside the script, so nothing here is a
-- function of the node list and `derive` never writes a row of it.
--
--   research_collections   a named, coloured folder of sources. Name unique per
--                          project; colour one of five closed names, each a
--                          themed token in packages/ui. Dropped by the
--                          repository when its last source leaves it.
--   research_sources       kind (article / document / image / interview /
--                          media), title, origin, note, the body text, who
--                          added it. `collection_id` set null when the folder
--                          goes - the source stays in the library.
--   research_clips         one highlighted line of a source. Cascades with it.
--   research_clip_filings  where a clip was sent: a character (key), a
--                          location (key) or a scene by its heading node's id
--                          with no key, as `shots.scene_node_id` (0006). A
--                          check keeps the columns honest to `kind`; three
--                          partial unique indexes refuse the same filing twice.
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001`, `0014` and `0016`: RLS on, the member-all policy, and
-- `anon` revoked. Safety net, not mechanism - the server connects with the
-- service-role key and the repositories are the gate.

CREATE TYPE "public"."research_collection_colour" AS ENUM('sky', 'violet', 'cobalt', 'terracotta', 'moss');--> statement-breakpoint
CREATE TYPE "public"."research_filing_kind" AS ENUM('character', 'location', 'scene');--> statement-breakpoint
CREATE TYPE "public"."research_source_kind" AS ENUM('article', 'document', 'image', 'interview', 'media');--> statement-breakpoint
CREATE TABLE "research_clip_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"clip_id" uuid NOT NULL,
	"kind" "research_filing_kind" NOT NULL,
	"character_id" uuid,
	"location_id" uuid,
	"scene_node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_clip_filings_one_target" CHECK (("research_clip_filings"."kind" = 'character' AND "research_clip_filings"."character_id" IS NOT NULL AND "research_clip_filings"."location_id" IS NULL AND "research_clip_filings"."scene_node_id" IS NULL)
       OR ("research_clip_filings"."kind" = 'location' AND "research_clip_filings"."location_id" IS NOT NULL AND "research_clip_filings"."character_id" IS NULL AND "research_clip_filings"."scene_node_id" IS NULL)
       OR ("research_clip_filings"."kind" = 'scene' AND "research_clip_filings"."scene_node_id" IS NOT NULL AND "research_clip_filings"."character_id" IS NULL AND "research_clip_filings"."location_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "research_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_clips_text_not_empty" CHECK (length(btrim("research_clips"."text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "research_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"colour" "research_collection_colour" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_collections_name_not_empty" CHECK (length(btrim("research_collections"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"collection_id" uuid,
	"kind" "research_source_kind" NOT NULL,
	"title" text NOT NULL,
	"origin" text,
	"note" text,
	"body" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_sources_title_not_empty" CHECK (length(btrim("research_sources"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "research_clip_filings" ADD CONSTRAINT "research_clip_filings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_clip_filings" ADD CONSTRAINT "research_clip_filings_clip_id_research_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."research_clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_clip_filings" ADD CONSTRAINT "research_clip_filings_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_clip_filings" ADD CONSTRAINT "research_clip_filings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_clips" ADD CONSTRAINT "research_clips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_clips" ADD CONSTRAINT "research_clips_source_id_research_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_clips" ADD CONSTRAINT "research_clips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_collections" ADD CONSTRAINT "research_collections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_collection_id_research_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."research_collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_clip_filings_clip_idx" ON "research_clip_filings" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX "research_clip_filings_project_idx" ON "research_clip_filings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "research_clip_filings_scene_idx" ON "research_clip_filings" USING btree ("project_id","scene_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_clip_filings_character_key" ON "research_clip_filings" USING btree ("clip_id","character_id") WHERE "research_clip_filings"."character_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "research_clip_filings_location_key" ON "research_clip_filings" USING btree ("clip_id","location_id") WHERE "research_clip_filings"."location_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "research_clip_filings_scene_key" ON "research_clip_filings" USING btree ("clip_id","scene_node_id") WHERE "research_clip_filings"."scene_node_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "research_clips_source_created_idx" ON "research_clips" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE INDEX "research_clips_project_idx" ON "research_clips" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_collections_project_name_key" ON "research_collections" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "research_sources_project_created_idx" ON "research_sources" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "research_sources_collection_idx" ON "research_sources" USING btree ("collection_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS. Safety net, not mechanism - see 0001's header. Members read and write
-- their project's research; nothing here is reachable by a non-member.
-- ---------------------------------------------------------------------------

ALTER TABLE public.research_collections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY research_collections_member_all ON public.research_collections
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.research_collections FROM anon;
--> statement-breakpoint

ALTER TABLE public.research_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY research_sources_member_all ON public.research_sources
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.research_sources FROM anon;
--> statement-breakpoint

ALTER TABLE public.research_clips ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY research_clips_member_all ON public.research_clips
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.research_clips FROM anon;
--> statement-breakpoint

ALTER TABLE public.research_clip_filings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY research_clip_filings_member_all ON public.research_clip_filings
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.research_clip_filings FROM anon;
