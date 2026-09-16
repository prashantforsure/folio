-- 0016 - the v2 redesign, first pass (shell and Script route): share links
-- and the assistant's chats.
--
-- Ruled 2026-09-16 (`docs/build-decisions.md`, "Redesign phase 1 - shell and
-- Script"): the `Share` button in every writing header issues share links -
-- the in-app invite AGENTS.md, Constraints has always named and nothing had
-- built - and the orb opens a real, read-only, persisted assistant.
--
--   share_links          AUTHORED. A token (32 URL-safe chars, unique across
--                        the database - the accept route holds only a token),
--                        a role (`writer | reader`; a link never issues
--                        ownership), who issued it, and `revoked_at`. The row
--                        survives revocation so `/share/:token` can say
--                        "revoked" rather than "not found". One live link per
--                        project is a repository rule (issuing revokes).
--   assistant_chats      AUTHORED. One conversation about one episode's script;
--                        `title` is the first user message, cut to a line, set
--                        by the repository. Cascades with the episode.
--   assistant_messages   AUTHORED. Its turns - `user` and `assistant`. No cost
--                        column: whether a message costs credits is open
--                        decision 13; nothing here touches the ledger.
--
-- The DDL is drizzle-kit's own. The RLS block at the foot is hand-written, on
-- the pattern of `0001`, `0011` and `0014`: RLS on, the member-all policy, and
-- `anon` revoked. Safety net, not mechanism - the server connects with the
-- service-role key and the repositories are the gate.

CREATE TYPE "public"."share_link_role" AS ENUM('writer', 'reader');--> statement-breakpoint
CREATE TYPE "public"."assistant_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"token" text NOT NULL,
	"role" "share_link_role" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "share_links_token_shape" CHECK ("share_links"."token" ~ '^[A-Za-z0-9_-]{32}$')
);
--> statement-breakpoint
CREATE TABLE "assistant_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"title" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" "assistant_role" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_messages_body_not_empty" CHECK (length(btrim("assistant_messages"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_chat_id_assistant_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."assistant_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "share_links_project_idx" ON "share_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assistant_chats_project_idx" ON "assistant_chats" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assistant_chats_episode_idx" ON "assistant_chats" USING btree ("episode_id","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_chat_idx" ON "assistant_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_project_idx" ON "assistant_messages" USING btree ("project_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for share_links. Safety net, not mechanism - see 0001's header.
--
-- Members read and write their project's links. Accepting a link is a
-- server-side write with the service-role key after the identity gate, so a
-- non-member never needs a policy here.
-- ---------------------------------------------------------------------------

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY share_links_member_all ON public.share_links
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.share_links FROM anon;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for assistant_chats. Same net.
-- ---------------------------------------------------------------------------

ALTER TABLE public.assistant_chats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY assistant_chats_member_all ON public.assistant_chats
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.assistant_chats FROM anon;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS for assistant_messages. Same net.
-- ---------------------------------------------------------------------------

ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY assistant_messages_member_all ON public.assistant_messages
  FOR ALL TO authenticated
  USING (public.folio_is_member(project_id))
  WITH CHECK (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE ALL ON public.assistant_messages FROM anon;
