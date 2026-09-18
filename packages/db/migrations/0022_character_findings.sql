-- 0022 - the Characters rebuild, phase 4: the assistant's findings.
--
-- `Check for contradictions` in the drawer reads the scenes a character is
-- in and asks the model for pairs of quotes that cannot both be true of
-- them - the script against itself, never against a note or a bible. The
-- answer is kept as rows so the writer's `It's deliberate` survives a
-- re-check and so a finding is two citations rather than prose in a chat.
--
--   character_findings   AUTHORED, on the assistant's word and the writer's
--                        verdict. One kind (contradiction), a status
--                        (open | deliberate), the two heading node ids
--                        stored sorted with no key (`shots.scene_node_id`'s
--                        convention), the two quotes, the claim, and the
--                        normalised claim's FNV-1a as a plain column so the
--                        dedupe index has a target. Cascades with the record.
--
-- AGENTS.md's "nothing is stored that can be computed" exception row: a
-- finding is a model's answer, not a function of the node list, so it is
-- stored and marked as the assistant's. The DDL is drizzle-kit's own; the
-- RLS block at the foot is hand-written on the pattern of `0016` and
-- `0019`: RLS on, the member-all policy, `anon` revoked. Safety net, not
-- mechanism - the server connects with the service-role key and the
-- repositories are the gate.

CREATE TYPE "public"."character_finding_kind" AS ENUM('contradiction');--> statement-breakpoint
CREATE TYPE "public"."character_finding_status" AS ENUM('open', 'deliberate');--> statement-breakpoint
CREATE TABLE "character_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"kind" character_finding_kind NOT NULL,
	"status" character_finding_status DEFAULT 'open' NOT NULL,
	"a_ref" uuid NOT NULL,
	"b_ref" uuid NOT NULL,
	"a_quote" text NOT NULL,
	"b_quote" text NOT NULL,
	"claim" text NOT NULL,
	"claim_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_findings_two_scenes" CHECK ("character_findings"."a_ref" <> "character_findings"."b_ref"),
	CONSTRAINT "character_findings_refs_sorted" CHECK ("character_findings"."a_ref" < "character_findings"."b_ref"),
	CONSTRAINT "character_findings_text_not_empty" CHECK (length(btrim("character_findings"."a_quote")) > 0 AND length(btrim("character_findings"."b_quote")) > 0 AND length(btrim("character_findings"."claim")) > 0)
);
--> statement-breakpoint
ALTER TABLE "character_findings" ADD CONSTRAINT "character_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_findings" ADD CONSTRAINT "character_findings_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_findings_character_status_idx" ON "character_findings" USING btree ("character_id","status");--> statement-breakpoint
CREATE INDEX "character_findings_project_idx" ON "character_findings" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_findings_dedupe_key" ON "character_findings" USING btree ("project_id","character_id","a_ref","b_ref","claim_hash");
--> statement-breakpoint

ALTER TABLE public.character_findings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY character_findings_member_all ON public.character_findings
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.character_findings FROM anon;
