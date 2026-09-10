-- ---------------------------------------------------------------------------
-- RLS, grants, the balance view, and append-only enforcement on the ledger.
--
-- AGENTS.md, Tenancy: "Project-scoped repositories **plus** RLS as defence in
-- depth. Server uses the service-role key, which bypasses RLS."
--
-- READ THAT TWICE BEFORE CHANGING ANYTHING IN THIS FILE.
--
-- Every policy below is a SAFETY NET. It is not the mechanism. The server
-- connects with the service-role key, which is `BYPASSRLS`, so none of these
-- policies is consulted on the path the application actually takes. What
-- stops one project's rows reaching another is the project-scoped repository
-- in `src/scope.ts`, enforced at compile time.
--
-- These policies matter when something other than the server holds a
-- connection: a leaked anon key, a Supabase Studio session, a future
-- client-side read, an engineer with a psql prompt. In those cases they are the
-- only thing standing there, which is why they exist even though nothing in the
-- application depends on them.
--
-- Two consequences worth stating plainly:
--
--   1. A bug in the repository layer is NOT caught by these policies, because
--      the service role bypasses them. There is no belt and braces on that
--      path - only the type system.
--   2. Adding a table without a policy leaves it readable by anyone holding an
--      anon key. RLS is enabled on every table below; a new table needs a new
--      migration that enables it too, and `FORCE ROW LEVEL SECURITY` is not
--      used, deliberately, because it would apply to the owner as well and
--      break the service-role path the application runs on.
--
-- Forward-only. Nothing in this file drops a column or a table.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 0. auth.uid(), for environments that are not Supabase
--
-- Supabase provides `auth.uid()`. A bare Postgres - a Docker container in CI,
-- or a local instance for testing this migration before it goes near a real
-- project - does not, and every policy below would fail to create.
--
-- So: create a shim ONLY if the function does not already exist. On a real
-- Supabase project this block does nothing at all. The shim reads the same JWT
-- claim Supabase's own implementation reads, so a policy behaves identically
-- either way; it simply returns NULL when there is no JWT, which denies.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regnamespace('auth') IS NULL THEN
    CREATE SCHEMA auth;
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $shim$
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $body$
        SELECT nullif(
          current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
          ''
        )::uuid
      $body$;
    $shim$;
  END IF;
END
$$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 1. Membership test
--
-- Every project-scoped policy is this one predicate. Written as a function so
-- there is exactly one definition of "may see this project" in the database,
-- and so changing it later is one migration rather than thirty.
--
-- SECURITY DEFINER, because the function reads `memberships` and the policy on
-- `memberships` will itself call this function. Without it the two recurse.
-- `search_path` is pinned for the usual reason.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.folio_is_member(target_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.project_id = target_project
      AND m.user_id = auth.uid()
  )
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.folio_is_member(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.folio_is_member(uuid) TO authenticated;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. Enable RLS everywhere
--
-- Every table, including the ones whose policies follow individually. A table
-- with RLS enabled and no policy denies everything to non-owners, which is the
-- correct default and the reason this statement comes first.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'users', 'projects', 'memberships', 'episodes',
    'documents', 'nodes', 'node_tombstones',
    'comment_threads', 'thread_comments',
    'versions', 'revisions', 'locked_pages',
    'measurements', 'measurement_pages', 'measurement_scenes', 'measurement_nodes',
    'characters', 'character_bound_cues', 'character_relationships',
    'character_derivations', 'character_cue_tallies',
    'locations', 'location_bound_sluglines',
    'location_derivations', 'location_slugline_tallies',
    'scenes', 'scene_derivations',
    'resolve_rows', 'resolve_decisions',
    'credit_ledger'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END
$$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. Authored, member-writable tables
--
-- A member may read and write. Roles are NOT enforced here: AGENTS.md,
-- Development philosophy 5 is "The server enforces; the client discloses", and
-- every capability gate belongs in the server action. Encoding a role matrix in
-- RLS would put a second, quieter authority next to the one that is supposed to
-- decide. `memberships.role` is stored and this layer does not read it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'episodes',
    'documents', 'nodes', 'node_tombstones',
    'comment_threads', 'thread_comments',
    'versions', 'revisions', 'locked_pages',
    'characters', 'character_bound_cues', 'character_relationships',
    'locations', 'location_bound_sluglines',
    'scenes', 'resolve_decisions'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.folio_is_member(project_id))
         WITH CHECK (public.folio_is_member(project_id))',
      target || '_member_all', target
    );
  END LOOP;
END
$$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. Derived caches and measurement records: readable, never writable
--
-- These rows are produced by `derive` and `paginate` on the server. A client
-- has no business writing one, and a client that could would be a second
-- authority on what the script says - which is the failure mode AGENTS.md calls
-- out in its opening paragraph.
--
-- SELECT only. No INSERT, UPDATE or DELETE policy exists for these tables, so
-- with RLS enabled those operations are denied outright for anyone who is not
-- the owner. The server writes them through the service role, which bypasses
-- all of this.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'measurements', 'measurement_pages', 'measurement_scenes', 'measurement_nodes',
    'character_derivations', 'character_cue_tallies',
    'location_derivations', 'location_slugline_tallies',
    'scene_derivations',
    'resolve_rows'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (public.folio_is_member(project_id))',
      target || '_member_select', target
    );
  END LOOP;
END
$$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. projects - the tenant column is the primary key
-- ---------------------------------------------------------------------------

CREATE POLICY projects_member_select ON public.projects
  FOR SELECT TO authenticated
  USING (public.folio_is_member(id));
--> statement-breakpoint

CREATE POLICY projects_member_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.folio_is_member(id))
  WITH CHECK (public.folio_is_member(id));
--> statement-breakpoint

-- No INSERT and no DELETE policy, on purpose. Creating a project has to also
-- create the owner's membership row, and the two must be one transaction or a
-- failure leaves a project nobody can reach. Deleting one is behind AGENTS.md,
-- When to ask first. Both are server operations.


-- ---------------------------------------------------------------------------
-- 6. memberships
--
-- Readable by fellow members, so the team list works. Not writable: an invite
-- is a share link redeemed server-side, and a client that could insert a
-- membership row could add itself to any project whose id it could guess.
-- ---------------------------------------------------------------------------

CREATE POLICY memberships_member_select ON public.memberships
  FOR SELECT TO authenticated
  USING (public.folio_is_member(project_id));
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 7. users - the one table with no project_id
--
-- A person may read their own row, and the rows of people they share a project
-- with, so avatars and names render on comments. They may update only their
-- own. They may not insert or delete: the row is created by the signup trigger
-- below and deleting an account is behind AGENTS.md, When to ask first.
-- ---------------------------------------------------------------------------

CREATE POLICY users_self_select ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.memberships mine
      JOIN public.memberships theirs ON theirs.project_id = mine.project_id
      WHERE mine.user_id = auth.uid()
        AND theirs.user_id = public.users.id
    )
  );
--> statement-breakpoint

CREATE POLICY users_self_update ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 8. credit_ledger - readable, and append-only for everybody
--
-- AGENTS.md: "The credits ledger is **append-only** and the balance is
-- **computed, never stored**."
--
-- Three mechanisms, deliberately not the same mechanism three times:
--
--   1. The repository exposes `append` and nothing else - a compile-time fact,
--      in `src/repositories/credits.ts`.
--   2. The trigger below, which stops a psql session and the Supabase Studio
--      table editor. It fires for the OWNER as well, so the service role does
--      not get an exemption. This is the only rule in the schema that the
--      application's own connection cannot get around, and that is intended.
--   3. The revoked grants, which stop a compromised anon or authenticated key
--      before the trigger is even reached.
-- ---------------------------------------------------------------------------

CREATE POLICY credit_ledger_member_select ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (public.folio_is_member(project_id));
--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE ON public.credit_ledger FROM authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON public.credit_ledger FROM anon;
--> statement-breakpoint

CREATE FUNCTION public.folio_ledger_is_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'credit_ledger is append-only: % is not permitted. The balance is computed from this table, so an entry that changes is a balance that cannot be reconstructed. Correct a mistake by appending an adjust entry with a reason.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint

CREATE TRIGGER credit_ledger_no_update
  BEFORE UPDATE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.folio_ledger_is_append_only();
--> statement-breakpoint

CREATE TRIGGER credit_ledger_no_delete
  BEFORE DELETE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.folio_ledger_is_append_only();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 9. The balance. A view, not a column.
--
-- AGENTS.md, exception table: "The ledger is the truth. Compute from the
-- append-only ledger. Never store a balance."
--
-- A view has no writer, so it cannot drift. `available` subtracts reservations
-- that have not yet been released or spent, which is what makes AGENTS.md's
-- "**Reserve then execute**" mean anything: a cost check has to compare against
-- what is left after work already promised.
--
-- `security_invoker` so the view is subject to the caller's RLS rather than the
-- view owner's. Without it, this view would be a hole straight through the
-- policy above.
-- ---------------------------------------------------------------------------

CREATE VIEW public.credit_balances
WITH (security_invoker = true)
AS
  SELECT
    l.project_id,
    coalesce(sum(l.delta), 0)::int AS settled,
    coalesce(sum(l.delta) FILTER (
      WHERE l.kind = 'reserve'
        AND NOT EXISTS (
          SELECT 1 FROM public.credit_ledger closing
          WHERE closing.project_id = l.project_id
            AND closing.job_id IS NOT DISTINCT FROM l.job_id
            AND closing.kind IN ('release', 'spend')
        )
    ), 0)::int AS reserved,
    (
      coalesce(sum(l.delta), 0)
      + coalesce(sum(l.delta) FILTER (
          WHERE l.kind = 'reserve'
            AND NOT EXISTS (
              SELECT 1 FROM public.credit_ledger closing
              WHERE closing.project_id = l.project_id
                AND closing.job_id IS NOT DISTINCT FROM l.job_id
                AND closing.kind IN ('release', 'spend')
            )
        ), 0)
    )::int AS available
  FROM public.credit_ledger l
  GROUP BY l.project_id;
--> statement-breakpoint

GRANT SELECT ON public.credit_balances TO authenticated;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 10. auth.users -> public.users
--
-- AGENTS.md, Tech stack: "`auth.users` is identity; `users`/`memberships` are
-- ours." There is deliberately no foreign key from `public.users` to
-- `auth.users`: that table is in a schema Supabase owns and upgrades, and a
-- cross-schema FK to it turns every one of their changes into our migration
-- problem. The link is this trigger instead.
--
-- Google OAuth only (AGENTS.md, Constraints - there is no email provider), so
-- the name and avatar come from the OAuth claims. On conflict the profile is
-- refreshed rather than left stale, because there is no settings page where a
-- user could fix it themselves.
--
-- Skipped entirely when `auth.users` does not exist, so this migration still
-- applies to a bare Postgres used for testing.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth.users not present: skipping the signup trigger. This is expected off Supabase.';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE FUNCTION public.folio_sync_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $body$
    BEGIN
      INSERT INTO public.users (id, email, display_name, avatar_url)
      VALUES (
        NEW.id,
        coalesce(NEW.email, ''),
        coalesce(
          NEW.raw_user_meta_data ->> 'full_name',
          NEW.raw_user_meta_data ->> 'name',
          split_part(coalesce(NEW.email, 'writer'), '@', 1)
        ),
        NEW.raw_user_meta_data ->> 'avatar_url'
      )
      ON CONFLICT (id) DO UPDATE SET
        email        = excluded.email,
        display_name = excluded.display_name,
        avatar_url   = excluded.avatar_url,
        updated_at   = now();
      RETURN NEW;
    END
    $body$;
  $fn$;

  EXECUTE $tg$
    CREATE TRIGGER folio_on_auth_user_change
      AFTER INSERT OR UPDATE ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.folio_sync_auth_user();
  $tg$;
END
$$;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 11. Baseline grants
--
-- Supabase grants broadly to `anon` and `authenticated` on `public` by default.
-- `anon` is nobody signed in, and nothing in this product is public - there is
-- no share-a-read-only-script surface in this version - so it gets nothing.
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
--> statement-breakpoint
