-- 0023 - the Timeline rebuild, phase 3: the writer's verdicts on the
-- continuity check.
--
-- The check is `@folio/script`'s `continuity.ts` - eight pure rules over
-- the story time the writer typed and what the page says (order, flashback
-- and flash-forward, unclocked days, a character in two places, a character
-- before their introduction, light against the clock, a silent thread, a
-- day gap), run on every read and stored nowhere. What a function of the
-- node list cannot know is that the writer looked at a finding and said
-- `It's deliberate`; a row here is that answer.
--
--   timeline_findings   AUTHORED. The finding's kind, its stable key (the
--                       check's own `kind:scene:other:subject`, unique per
--                       project - what the route matches on), the two
--                       heading node ids with no key (`shots.scene_node_id`'s
--                       convention: a scene that leaves the script leaves its
--                       verdict unmatched, and unmatched is invisible) and
--                       the subject. A row is the verdict; `Reopen` deletes
--                       it. Cascades with the project.
--
-- Ruled 2026-09-18: the `character_findings` shape, a row only when the
-- writer says deliberate. The DDL is drizzle-kit's own; the RLS block at the
-- foot is hand-written on the pattern of `0016` and `0022`: RLS on, the
-- member-all policy, `anon` revoked. Safety net, not mechanism - the server
-- connects with the service-role key and the repositories are the gate.

CREATE TYPE "public"."timeline_finding_kind" AS ENUM('order', 'flashback', 'flashforward', 'same-day-unclocked', 'two-places', 'before-introduction', 'light-vs-clock', 'thread-silent', 'day-gap');--> statement-breakpoint
CREATE TABLE "timeline_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" timeline_finding_kind NOT NULL,
	"key" text NOT NULL,
	"a_ref" uuid NOT NULL,
	"b_ref" uuid,
	"subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeline_findings_key_not_empty" CHECK (length(btrim("timeline_findings"."key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "timeline_findings" ADD CONSTRAINT "timeline_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timeline_findings_project_idx" ON "timeline_findings" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_findings_key" ON "timeline_findings" USING btree ("project_id","key");
--> statement-breakpoint

ALTER TABLE public.timeline_findings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY timeline_findings_member_all ON public.timeline_findings
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.timeline_findings FROM anon;
