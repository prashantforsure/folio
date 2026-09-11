CREATE TYPE "public"."invited_via" AS ENUM('created', 'share_link');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_kind" AS ENUM('grant', 'purchase', 'reserve', 'release', 'spend', 'refund', 'expire', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'writer', 'reader');--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('film', 'series');--> statement-breakpoint
CREATE TYPE "public"."revision_colour" AS ENUM('white', 'blue', 'pink', 'yellow', 'green');--> statement-breakpoint
CREATE TYPE "public"."delivery_modifier" AS ENUM('V.O.', 'O.S.', 'O.C.');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('screenplay', 'outline');--> statement-breakpoint
CREATE TYPE "public"."node_type" AS ENUM('scene', 'action', 'character', 'paren', 'dialogue', 'transition', 'comment', 'subtitle', 'body', 'h1', 'h2', 'h3', 'quote', 'rule', 'beat');--> statement-breakpoint
CREATE TYPE "public"."provenance_source" AS ENUM('typed', 'agent');--> statement-breakpoint
CREATE TYPE "public"."tombstone_reason" AS ENUM('deleted', 'merged');--> statement-breakpoint
CREATE TYPE "public"."thread_anchor_kind" AS ENUM('script_node', 'beat', 'outline_block', 'storyboard_shot');--> statement-breakpoint
CREATE TYPE "public"."thread_state" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."version_reason" AS ENUM('autosave', 'manual', 'before_agent_run', 'before_import', 'before_rename');--> statement-breakpoint
CREATE TYPE "public"."page_mode" AS ENUM('paged', 'continuous');--> statement-breakpoint
CREATE TYPE "public"."script_format" AS ENUM('hollywood', 'asian');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('certain', 'likely', 'possible');--> statement-breakpoint
CREATE TYPE "public"."interior_exterior" AS ENUM('INT', 'EXT', 'INT/EXT', 'EST');--> statement-breakpoint
CREATE TYPE "public"."light" AS ENUM('day', 'night', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."presence" AS ENUM('present', 'absent');--> statement-breakpoint
CREATE TYPE "public"."resolve_row_state" AS ENUM('open', 'settled', 'gone');--> statement-breakpoint
CREATE TYPE "public"."resolve_subject_kind" AS ENUM('cue', 'slugline', 'structure');--> statement-breakpoint
CREATE TYPE "public"."resolve_verdict" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"revision_colour" "revision_colour" DEFAULT 'white' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodes_slug_shape" CHECK ("episodes"."slug" ~ '^ep_[0-9]{3,}$'),
	CONSTRAINT "episodes_ordinal_positive" CHECK ("episodes"."ordinal" >= 1)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"invited_via" "invited_via" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" "project_kind" NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trashed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_tombstones" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"reason" "tombstone_reason" NOT NULL,
	"merged_into" uuid,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_by" uuid,
	CONSTRAINT "node_tombstones_merge_names_survivor" CHECK (("node_tombstones"."reason" = 'merged') = ("node_tombstones"."merged_into" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_kind" "document_kind" NOT NULL,
	"type" "node_type" NOT NULL,
	"order_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"modifiers" "delivery_modifier"[] DEFAULT ARRAY[]::delivery_modifier[] NOT NULL,
	"provenance_source" "provenance_source" NOT NULL,
	"provenance_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_type_matches_document_kind" CHECK ((
        ("nodes"."document_kind" = 'screenplay' AND "nodes"."type" IN ('scene', 'action', 'character', 'paren', 'dialogue', 'transition', 'comment', 'subtitle'))
        OR
        ("nodes"."document_kind" = 'outline' AND "nodes"."type" IN ('body', 'h1', 'h2', 'h3', 'quote', 'rule', 'beat'))
      )),
	CONSTRAINT "nodes_provenance_run_matches_source" CHECK (("nodes"."provenance_source" = 'agent') = ("nodes"."provenance_run_id" IS NOT NULL)),
	CONSTRAINT "nodes_modifiers_only_on_cues" CHECK ("nodes"."type" = 'character' OR cardinality("nodes"."modifiers") = 0)
);
--> statement-breakpoint
CREATE TABLE "comment_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"anchor_kind" "thread_anchor_kind" NOT NULL,
	"anchor_node_id" uuid,
	"anchor_shot_id" uuid,
	"state" "thread_state" DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "comment_threads_anchor_matches_kind" CHECK (("comment_threads"."anchor_kind" = 'storyboard_shot') = ("comment_threads"."anchor_shot_id" IS NOT NULL)
          AND ("comment_threads"."anchor_kind" <> 'storyboard_shot') = ("comment_threads"."anchor_node_id" IS NOT NULL)),
	CONSTRAINT "comment_threads_resolution_consistent" CHECK (("comment_threads"."state" = 'resolved') = ("comment_threads"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "thread_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "thread_comments_body_not_empty" CHECK (length(btrim("thread_comments"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "locked_pages" (
	"project_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"label" text NOT NULL,
	"anchor_node_id" uuid,
	"colour" "revision_colour" NOT NULL,
	CONSTRAINT "locked_pages_revision_id_label_pk" PRIMARY KEY("revision_id","label"),
	CONSTRAINT "locked_pages_label_not_empty" CHECK (length(btrim("locked_pages"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"colour" "revision_colour" NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"lines_added" integer DEFAULT 0 NOT NULL,
	"lines_deleted" integer DEFAULT 0 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"version_id" uuid,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revisions_ordinal_positive" CHECK ("revisions"."ordinal" >= 1),
	CONSTRAINT "revisions_line_counts_not_negative" CHECK ("revisions"."lines_added" >= 0 AND "revisions"."lines_deleted" >= 0)
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"reason" "version_reason" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"node_count" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_ordinal_positive" CHECK ("versions"."ordinal" >= 1),
	CONSTRAINT "versions_node_count_not_negative" CHECK ("versions"."node_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "measurement_nodes" (
	"project_id" uuid NOT NULL,
	"measurement_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"first_page" integer NOT NULL,
	"last_page" integer NOT NULL,
	"lines" integer NOT NULL,
	"runs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "measurement_nodes_measurement_id_node_id_pk" PRIMARY KEY("measurement_id","node_id"),
	CONSTRAINT "measurement_nodes_pages_ordered" CHECK ("measurement_nodes"."first_page" >= 1 AND "measurement_nodes"."last_page" >= "measurement_nodes"."first_page"),
	CONSTRAINT "measurement_nodes_lines_not_negative" CHECK ("measurement_nodes"."lines" >= 0)
);
--> statement-breakpoint
CREATE TABLE "measurement_pages" (
	"project_id" uuid NOT NULL,
	"measurement_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"colour" "revision_colour" NOT NULL,
	"lines_used" integer NOT NULL,
	"first_node_id" uuid,
	"artefacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "measurement_pages_measurement_id_ordinal_pk" PRIMARY KEY("measurement_id","ordinal"),
	CONSTRAINT "measurement_pages_ordinal_positive" CHECK ("measurement_pages"."ordinal" >= 1)
);
--> statement-breakpoint
CREATE TABLE "measurement_scenes" (
	"project_id" uuid NOT NULL,
	"measurement_id" uuid NOT NULL,
	"scene_node_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"start_page" integer NOT NULL,
	"end_page" integer NOT NULL,
	"lines" integer NOT NULL,
	"eighths" integer NOT NULL,
	CONSTRAINT "measurement_scenes_measurement_id_scene_node_id_pk" PRIMARY KEY("measurement_id","scene_node_id"),
	CONSTRAINT "measurement_scenes_pages_ordered" CHECK ("measurement_scenes"."start_page" >= 1 AND "measurement_scenes"."end_page" >= "measurement_scenes"."start_page"),
	CONSTRAINT "measurement_scenes_counts_not_negative" CHECK ("measurement_scenes"."lines" >= 0 AND "measurement_scenes"."eighths" >= 0)
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"format" "script_format" NOT NULL,
	"page_mode" "page_mode" NOT NULL,
	"live_repaginate" boolean DEFAULT false NOT NULL,
	"sheet" jsonb NOT NULL,
	"total_pages" integer NOT NULL,
	"total_lines" integer NOT NULL,
	"total_scenes" integer NOT NULL,
	"total_eighths" integer NOT NULL,
	"node_digest" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurements_totals_not_negative" CHECK ("measurements"."total_pages" >= 0 AND "measurements"."total_lines" >= 0
          AND "measurements"."total_scenes" >= 0 AND "measurements"."total_eighths" >= 0)
);
--> statement-breakpoint
CREATE TABLE "character_bound_cues" (
	"project_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"cue" text NOT NULL,
	"bound_by" uuid,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_bound_cues_character_id_cue_pk" PRIMARY KEY("character_id","cue")
);
--> statement-breakpoint
CREATE TABLE "character_cue_tallies" (
	"project_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"cue" text NOT NULL,
	"key" text NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"lines" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "character_cue_tallies_character_id_cue_pk" PRIMARY KEY("character_id","cue")
);
--> statement-breakpoint
CREATE TABLE "character_derivations" (
	"project_id" uuid NOT NULL,
	"character_id" uuid PRIMARY KEY NOT NULL,
	"appearances" integer DEFAULT 0 NOT NULL,
	"lines" integer DEFAULT 0 NOT NULL,
	"mentions" integer DEFAULT 0 NOT NULL,
	"presence" "presence" NOT NULL,
	"scenes" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_derivations_counts_not_negative" CHECK ("character_derivations"."appearances" >= 0 AND "character_derivations"."lines" >= 0 AND "character_derivations"."mentions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "character_relationships" (
	"project_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"other_id" uuid NOT NULL,
	"what" text NOT NULL,
	CONSTRAINT "character_relationships_character_id_other_id_pk" PRIMARY KEY("character_id","other_id"),
	CONSTRAINT "character_relationships_not_self" CHECK ("character_relationships"."character_id" <> "character_relationships"."other_id")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_into" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_name_not_empty" CHECK (length(btrim("characters"."name")) > 0),
	CONSTRAINT "characters_not_merged_into_self" CHECK ("characters"."merged_into" IS DISTINCT FROM "characters"."id")
);
--> statement-breakpoint
CREATE TABLE "location_bound_sluglines" (
	"project_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"slugline" text NOT NULL,
	"bound_by" uuid,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_bound_sluglines_location_id_slugline_pk" PRIMARY KEY("location_id","slugline")
);
--> statement-breakpoint
CREATE TABLE "location_derivations" (
	"project_id" uuid NOT NULL,
	"location_id" uuid PRIMARY KEY NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"presence" "presence" NOT NULL,
	"own_scenes" integer DEFAULT 0 NOT NULL,
	"own_sluglines" integer DEFAULT 0 NOT NULL,
	"own_day_scenes" integer DEFAULT 0 NOT NULL,
	"own_night_scenes" integer DEFAULT 0 NOT NULL,
	"own_shooting_days" integer DEFAULT 0 NOT NULL,
	"rollup_scenes" integer DEFAULT 0 NOT NULL,
	"rollup_sluglines" integer DEFAULT 0 NOT NULL,
	"rollup_day_scenes" integer DEFAULT 0 NOT NULL,
	"rollup_night_scenes" integer DEFAULT 0 NOT NULL,
	"rollup_shooting_days" integer DEFAULT 0 NOT NULL,
	"scenes" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_derivations_depth_not_negative" CHECK ("location_derivations"."depth" >= 0),
	CONSTRAINT "location_derivations_rollup_covers_own" CHECK ("location_derivations"."rollup_scenes" >= "location_derivations"."own_scenes"
          AND "location_derivations"."rollup_shooting_days" >= "location_derivations"."own_shooting_days")
);
--> statement-breakpoint
CREATE TABLE "location_slugline_tallies" (
	"project_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"slugline" text NOT NULL,
	"key" text NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "location_slugline_tallies_location_id_slugline_pk" PRIMARY KEY("location_id","slugline")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"description" text,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_name_not_empty" CHECK (length(btrim("locations"."name")) > 0),
	CONSTRAINT "locations_not_own_parent" CHECK ("locations"."parent_id" IS DISTINCT FROM "locations"."id"),
	CONSTRAINT "locations_scheduled_days_not_negative" CHECK ("locations"."scheduled_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resolve_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"verdict" "resolve_verdict" NOT NULL,
	"target" jsonb NOT NULL,
	"target_key" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolve_rows" (
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"subject_kind" "resolve_subject_kind" NOT NULL,
	"subject" jsonb NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"scenes" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"proposal_target" jsonb,
	"proposal_confidence" "confidence",
	"suppressed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" "resolve_row_state" NOT NULL,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolve_rows_project_id_key_pk" PRIMARY KEY("project_id","key"),
	CONSTRAINT "resolve_rows_proposal_complete" CHECK (("resolve_rows"."proposal_target" IS NULL) = ("resolve_rows"."proposal_confidence" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "scene_derivations" (
	"project_id" uuid NOT NULL,
	"scene_node_id" uuid PRIMARY KEY NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"heading" text NOT NULL,
	"reading" jsonb NOT NULL,
	"location_id" uuid,
	"cast" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"speaking" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"mentioned" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"unresolved_cues" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"cast_size" integer DEFAULT 0 NOT NULL,
	"lines" integer DEFAULT 0 NOT NULL,
	"presence" "presence" NOT NULL,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_derivations_number_not_negative" CHECK ("scene_derivations"."number" >= 0),
	CONSTRAINT "scene_derivations_number_matches_presence" CHECK (("scene_derivations"."presence" = 'absent') = ("scene_derivations"."number" = 0))
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"scene_node_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"synopsis" text,
	"story_time" text,
	"beats" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"threads" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "ledger_entry_kind" NOT NULL,
	"delta" integer NOT NULL,
	"job_id" uuid,
	"external_ref" text,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_delta_matches_kind" CHECK ((
        ("credit_ledger"."kind" IN ('reserve', 'spend', 'expire') AND "credit_ledger"."delta" < 0)
        OR ("credit_ledger"."kind" IN ('grant', 'purchase', 'release', 'refund') AND "credit_ledger"."delta" > 0)
        OR ("credit_ledger"."kind" = 'adjust' AND "credit_ledger"."delta" <> 0)
      )),
	CONSTRAINT "credit_ledger_adjust_states_reason" CHECK ("credit_ledger"."kind" <> 'adjust' OR length(btrim(coalesce("credit_ledger"."reason", ''))) > 0)
);
--> statement-breakpoint
-- Moved up from the index block below. drizzle-kit writes every foreign key
-- before every index, and the composite key on "nodes" two dozen statements
-- down references this unique index - so as generated, the file could not be
-- applied to any Postgres: "there is no unique constraint matching given keys
-- for referenced table". The reorder was made before this migration had ever
-- been applied anywhere; see the phase report for the shell routes.
CREATE UNIQUE INDEX "documents_id_kind_key" ON "documents" USING btree ("id","kind");--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_tombstones" ADD CONSTRAINT "node_tombstones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_tombstones" ADD CONSTRAINT "node_tombstones_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_tombstones" ADD CONSTRAINT "node_tombstones_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_document_kind_fk" FOREIGN KEY ("document_id","document_kind") REFERENCES "public"."documents"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_anchor_node_id_nodes_id_fk" FOREIGN KEY ("anchor_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_comments" ADD CONSTRAINT "thread_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_comments" ADD CONSTRAINT "thread_comments_thread_id_comment_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."comment_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_comments" ADD CONSTRAINT "thread_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locked_pages" ADD CONSTRAINT "locked_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locked_pages" ADD CONSTRAINT "locked_pages_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locked_pages" ADD CONSTRAINT "locked_pages_anchor_node_id_nodes_id_fk" FOREIGN KEY ("anchor_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_nodes" ADD CONSTRAINT "measurement_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_nodes" ADD CONSTRAINT "measurement_nodes_measurement_id_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_nodes" ADD CONSTRAINT "measurement_nodes_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_pages" ADD CONSTRAINT "measurement_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_pages" ADD CONSTRAINT "measurement_pages_measurement_id_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_pages" ADD CONSTRAINT "measurement_pages_first_node_id_nodes_id_fk" FOREIGN KEY ("first_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_scenes" ADD CONSTRAINT "measurement_scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_scenes" ADD CONSTRAINT "measurement_scenes_measurement_id_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_scenes" ADD CONSTRAINT "measurement_scenes_scene_node_id_nodes_id_fk" FOREIGN KEY ("scene_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_bound_cues" ADD CONSTRAINT "character_bound_cues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_bound_cues" ADD CONSTRAINT "character_bound_cues_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_bound_cues" ADD CONSTRAINT "character_bound_cues_bound_by_users_id_fk" FOREIGN KEY ("bound_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_cue_tallies" ADD CONSTRAINT "character_cue_tallies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_cue_tallies" ADD CONSTRAINT "character_cue_tallies_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD CONSTRAINT "character_derivations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_derivations" ADD CONSTRAINT "character_derivations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_other_id_characters_id_fk" FOREIGN KEY ("other_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_bound_sluglines" ADD CONSTRAINT "location_bound_sluglines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_bound_sluglines" ADD CONSTRAINT "location_bound_sluglines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_bound_sluglines" ADD CONSTRAINT "location_bound_sluglines_bound_by_users_id_fk" FOREIGN KEY ("bound_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_derivations" ADD CONSTRAINT "location_derivations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_derivations" ADD CONSTRAINT "location_derivations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_slugline_tallies" ADD CONSTRAINT "location_slugline_tallies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_slugline_tallies" ADD CONSTRAINT "location_slugline_tallies_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolve_decisions" ADD CONSTRAINT "resolve_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolve_decisions" ADD CONSTRAINT "resolve_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolve_rows" ADD CONSTRAINT "resolve_rows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_derivations" ADD CONSTRAINT "scene_derivations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_derivations" ADD CONSTRAINT "scene_derivations_scene_node_id_scenes_scene_node_id_fk" FOREIGN KEY ("scene_node_id") REFERENCES "public"."scenes"("scene_node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_derivations" ADD CONSTRAINT "scene_derivations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_project_slug_key" ON "episodes" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_project_ordinal_key" ON "episodes" USING btree ("project_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_project_user_key" ON "memberships" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_created_by_idx" ON "projects" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "documents_episode_idx" ON "documents" USING btree ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_episode_kind_key" ON "documents" USING btree ("episode_id","kind");--> statement-breakpoint
CREATE INDEX "node_tombstones_project_idx" ON "node_tombstones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "node_tombstones_merged_into_idx" ON "node_tombstones" USING btree ("merged_into");--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_document_order_key" ON "nodes" USING btree ("document_id","order_key");--> statement-breakpoint
CREATE INDEX "nodes_document_idx" ON "nodes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "nodes_project_idx" ON "nodes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "comment_threads_project_idx" ON "comment_threads" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "comment_threads_anchor_node_idx" ON "comment_threads" USING btree ("anchor_node_id");--> statement-breakpoint
CREATE INDEX "comment_threads_state_idx" ON "comment_threads" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "thread_comments_thread_idx" ON "thread_comments" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "thread_comments_project_idx" ON "thread_comments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "locked_pages_project_idx" ON "locked_pages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "locked_pages_anchor_idx" ON "locked_pages" USING btree ("anchor_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_episode_ordinal_key" ON "revisions" USING btree ("episode_id","ordinal");--> statement-breakpoint
CREATE INDEX "revisions_project_idx" ON "revisions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_document_ordinal_key" ON "versions" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "versions_project_idx" ON "versions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "versions_document_created_idx" ON "versions" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "measurement_nodes_project_idx" ON "measurement_nodes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "measurement_pages_project_idx" ON "measurement_pages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "measurement_scenes_project_idx" ON "measurement_scenes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "measurement_scenes_number_idx" ON "measurement_scenes" USING btree ("measurement_id","number");--> statement-breakpoint
CREATE INDEX "measurements_project_idx" ON "measurements" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "measurements_document_format_mode_key" ON "measurements" USING btree ("document_id","format","page_mode");--> statement-breakpoint
CREATE UNIQUE INDEX "character_bound_cues_project_cue_key" ON "character_bound_cues" USING btree ("project_id","cue");--> statement-breakpoint
CREATE INDEX "character_cue_tallies_project_key_idx" ON "character_cue_tallies" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "character_derivations_project_idx" ON "character_derivations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "character_derivations_presence_idx" ON "character_derivations" USING btree ("project_id","presence");--> statement-breakpoint
CREATE INDEX "character_relationships_project_idx" ON "character_relationships" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "characters_project_idx" ON "characters" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "location_bound_sluglines_project_key" ON "location_bound_sluglines" USING btree ("project_id","slugline");--> statement-breakpoint
CREATE INDEX "location_derivations_project_idx" ON "location_derivations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "location_slugline_tallies_project_key_idx" ON "location_slugline_tallies" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "locations_project_idx" ON "locations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "locations_parent_idx" ON "locations" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resolve_decisions_row_target_key" ON "resolve_decisions" USING btree ("project_id","row_key","target_key");--> statement-breakpoint
CREATE INDEX "resolve_decisions_project_idx" ON "resolve_decisions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "resolve_rows_state_idx" ON "resolve_rows" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "scene_derivations_project_number_idx" ON "scene_derivations" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "scene_derivations_location_idx" ON "scene_derivations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "scenes_project_idx" ON "scenes" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_key" ON "credit_ledger" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_project_occurred_idx" ON "credit_ledger" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_job_idx" ON "credit_ledger" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_reserve_idx" ON "credit_ledger" USING btree ("project_id","job_id") WHERE kind = 'reserve';