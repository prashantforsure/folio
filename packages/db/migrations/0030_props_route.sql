-- 0030 - the Props route: a prop becomes a record, and Production's two
-- free-text `prop` columns become foreign keys to it.
--
-- A prop is the one entity here that is **authored end to end**. A character
-- comes from a cue and a set from a slugline, so each has a derived cache
-- beside its authored row; nothing in a node list is a prop - a bat is a noun
-- in a line of action and no pass can tell it from a bench. So there is no
-- `prop_derivations`, no tally table and no resolve queue, and what the script
-- says about a prop is read at request time (`@folio/script`, `props.ts`) over
-- the node list the route already holds. AGENTS.md, "Nothing is stored that
-- can be computed": this is none of the three exempted cases, so it is not
-- stored.
--
--   ADD   prop_status      needed | sourced | on set
--   ADD   props            name, category (free text, never an enum),
--                          description, status, photo_key, merge tombstone
--   ADD   prop_aliases     the alias table's authored half
--
-- `prop_aliases` is `location_bound_sluglines` **minus its
-- unique-per-project index**, and that is the one real difference between
-- them. A slugline resolves to exactly one set, so an ambiguous spelling has
-- to go to a queue; a prop alias resolves nothing - it only makes a line of
-- action worth quoting - and two props may both answer to "the bag", the one
-- Meera carries and the one that comes back empty. Both should collect the
-- line. The primary key is still `(prop_id, alias)`, so one prop cannot hold
-- the same spelling twice.
--
--   DROP  scenes.prop      text -> prop_id uuid references props(id)
--   DROP  reel_shots.prop  text -> prop_id uuid references props(id)
--
-- The two `prop` columns were free text because there was no table to point
-- at: "Game ball", "game ball" and "the ball" were three props and none of
-- them was a record, and the scene-setup menu that wrote them could never
-- draw its search box, because its vocabulary was the distinct values already
-- stored and nothing could put a first one there. **Both columns hold zero
-- rows today**, so the swap is a drop and an add with nothing to migrate -
-- and it will not be free later. `on delete set null`, like `location_id`
-- beside them: deleting the record clears the field, never the row.
--
-- The adds are generated - drizzle-kit's own DDL, through `drizzle-kit/api`
-- in two prompt-free diffs (the `0024` method: a same-table drop + add makes
-- `db:generate` ask "is `prop_id` `prop` renamed?" and exit without a TTY, so
-- `0029` -> an intermediate snapshot with the two `prop` columns absent ->
-- the schema). The two old columns are dropped at the foot rather than the
-- head, so nothing is without a home between statements. The RLS block is
-- hand-written on the pattern of `0009`, `0016` and `0022`: RLS on, the
-- member-all policy every other authored table has, `anon` gets nothing.
-- Forward-only, as every migration is.

CREATE TYPE "public"."prop_status" AS ENUM('needed', 'sourced', 'on set');
--> statement-breakpoint
CREATE TABLE "prop_aliases" (
	"project_id" uuid NOT NULL,
	"prop_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"bound_by" uuid,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prop_aliases_prop_id_alias_pk" PRIMARY KEY("prop_id","alias"),
	CONSTRAINT "prop_aliases_not_empty" CHECK (length(btrim("prop_aliases"."alias")) > 0)
);

--> statement-breakpoint
CREATE TABLE "props" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"status" "prop_status" DEFAULT 'needed' NOT NULL,
	"photo_key" text,
	"merged_into" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "props_name_not_empty" CHECK (length(btrim("props"."name")) > 0),
	CONSTRAINT "props_not_merged_into_self" CHECK ("props"."merged_into" IS DISTINCT FROM "props"."id")
);

--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "prop_id" uuid;
--> statement-breakpoint
ALTER TABLE "reel_shots" ADD COLUMN "prop_id" uuid;
--> statement-breakpoint
ALTER TABLE "prop_aliases" ADD CONSTRAINT "prop_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prop_aliases" ADD CONSTRAINT "prop_aliases_prop_id_props_id_fk" FOREIGN KEY ("prop_id") REFERENCES "public"."props"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prop_aliases" ADD CONSTRAINT "prop_aliases_bound_by_users_id_fk" FOREIGN KEY ("bound_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "props" ADD CONSTRAINT "props_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "prop_aliases_project_idx" ON "prop_aliases" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "props_project_idx" ON "props" USING btree ("project_id");
--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_prop_id_props_id_fk" FOREIGN KEY ("prop_id") REFERENCES "public"."props"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reel_shots" ADD CONSTRAINT "reel_shots_prop_id_props_id_fk" FOREIGN KEY ("prop_id") REFERENCES "public"."props"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scenes" DROP COLUMN "prop";
--> statement-breakpoint
ALTER TABLE "reel_shots" DROP COLUMN "prop";

-- ---------------------------------------------------------------------------
-- RLS for props and prop_aliases. Safety net, not mechanism - see 0001's header.
-- ---------------------------------------------------------------------------

ALTER TABLE public.props ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY props_member_all ON public.props
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.props FROM anon;
--> statement-breakpoint

ALTER TABLE public.prop_aliases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY prop_aliases_member_all ON public.prop_aliases
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.prop_aliases FROM anon;
