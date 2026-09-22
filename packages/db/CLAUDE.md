# packages/db

Loads when you work in this directory. Root `CLAUDE.md` still applies.

Before adding a table or asking what may write one, read
[src/schema/index.ts](src/schema/index.ts) — every table is classified
authored / derived-cache / measurement. Touching `episodes` needs
[ADR 0002](../../docs/adr/0002-episode-identity.md) first.

- **Tenancy is a compile error, not a review catch.** [scope.ts](src/scope.ts): a `ProjectScope` is
  keyed by a private `unique symbol` so it cannot be fabricated; every repository takes one; the
  handle sits behind a second symbol; a table without `project_id` is not assignable.
  [scope-guarantees.ts](src/scope-guarantees.ts) proves all four with `@ts-expect-error`, so
  `pnpm typecheck` is the test that they hold.
- **Nothing needs a live database.** Both factories in [client.ts](src/client.ts) are lazy —
  importing `@folio/db` for a table definition reads no env and opens no socket.
- **[env.ts](src/env.ts) is the only reader of secrets** (`@folio/db/env`), loads `.env` itself,
  and **throws at module scope in a browser** — correct for a file holding the service-role key.
  The two public `NEXT_PUBLIC_SUPABASE_*` values therefore live in `apps/web/lib/env/public.ts`,
  not here.
- **Migrations `0000`–`0026` are applied to the dev Supabase project** and are forward-only.
  (`0017` and `0018` went in one `db:migrate` run on 2026-09-16: drizzle-kit applies every
  pending journal entry, there is no one-at-a-time; `0019` followed in its own run.)
  `0000` was reordered once, before it had ever run anywhere ("Shell routes phase" in
  `docs/build-decisions.md`); `0010` is the sanctioned `DROP TABLE beats`, alone in its file;
  `0013` is the sanctioned drop of the first Characters profile (nine columns, one table), on
  the client's explicit ruling; `0014` adds `reels` and `reel_renders` and the `reel_id` /
  `kept_at` / `render_resolution` columns, with `reels.order_key` collated `C` by hand as
  `shots.order_key` was; `0015` is the sanctioned drop of the five bible tables and their three
  enums, alone in its file, on the client's ruling ("Bible route removed" in git history);
  `0016` adds `share_links`, `assistant_chats` and `assistant_messages` for the v2 redesign's
  first pass, RLS block hand-written on the `0014` pattern; `0017` adds `characters.status`
  (`character_status`: draft / defined / locked), `wants` and `needs` for the Characters v2 pass -
  additive, generated with placeholder env values present (`generate` reads no socket); `0018`
  adds `locations.status` (`location_status`: pending / scouted / locked), `address` and
  `photo_key` for the Locations v2 pass and **drops `location_arc_notes`** - its only readers
  were that route's own, so it goes the way `0015` went rather than the way `revisions` did;
  `0019` adds the four Research tables (`research_collections`, `research_sources`,
  `research_clips`, `research_clip_filings`) and three enums for the Research v2 pass - additive,
  RLS block hand-written on the `0016` pattern; `research_clip_filings.scene_node_id` has no key,
  as `shots.scene_node_id` (`schema/research.ts` says why).
  `0020` adds `shots.canvas_x` / `canvas_y` (where the Storyboard canvas left a card; null = laid
  out from `order_key`, both-or-neither by a check) and `shots.frame_upload_url` (a frame the
  writer uploaded, a URL like `frame_generations.frame_url`) - additive, generated with
  placeholder env values as `0017` was, applied in its own run on 2026-09-17. `foldUpload` in
  `repositories/storyboard.ts` is where an upload beats a generation.
  `0021` (the Characters rebuild, phase 3) adds `character_origin` and `characters.origin`, the
  voice columns on `character_derivations` (`words`, `speeches`, `parens`, `named_in`, four
  jsonb positions, `scene_counts` and `exchanges` as jsonb lists), `character_cue_tallies.words`
  and `scene_derivations.words` - additive, DERIVED CACHE except `origin`. `0022` (phase 4)
  adds `character_findings` and its two enums, AUTHORED on the assistant's word, RLS block
  hand-written on the `0016` pattern. Both went in one `db:migrate` run on 2026-09-18 (both were
  pending; drizzle-kit applies every pending entry). `0023` (the Timeline rebuild, phase 3) adds
  `timeline_findings` and its kind enum - AUTHORED, the writer's `It's deliberate` on a continuity
  finding, keyed on the pure check's own key; a row is the verdict, there is no status column -
  RLS block hand-written on the `0022` pattern, applied in its own run on 2026-09-18.
  `0024` (the Characters fourth pass, 2026-09-20) adds `characters.canvas_x` / `canvas_y` (both or
  neither, the `0020` pattern) and **reshapes `character_relationships`** - drops `what` / `shift`
  and the self check, adds `a_is` / `b_is` (two directional labels, at least one non-empty) /
  `description` / stamps and an `a < b` check, one row per unordered pair; the table was empty, so
  drop + add, not a rename. Generated through `drizzle-kit/api` in **two prompt-free diffs** from a
  one-off script (`0023` → an intermediate snapshot with only the drops → the schema): a
  same-table drop + add makes both `db:generate` and the API prompt "is `a_is` `what` renamed?"
  and exit without a TTY - then **reordered by hand with a fold**: dev held one row from the first
  Characters route stored `character_id > other_id`, so the adds come first, every directed row is
  folded into the pair shape (`what` → `a_is` / `b_is` by direction, `shift` → `description`), and
  the drops and checks come last; the end state is the snapshot's. `db:check` clean; applied in
  its own run on 2026-09-20 through `drizzle-orm/postgres-js/migrator` directly - `db:migrate`
  failed silently twice (the `a < b` check, then the fold's `NOT NULL` on `what`) and only the
  direct migrator showed which statement.
  `character_findings` (`0022`) is orphaned by the same pass and kept (dropping it is ask-first).
  `0025` (the Production v12 rebuild, 2026-09-22) is the sanctioned drop of the v1 Production
  surface `0014` added: `reels`, `reel_renders`, `shots.reel_id`, `frame_generations.kept_at`,
  `projects.render_resolution`, and `job_kind`'s `reel_render` (drizzle-kit recreates the type;
  two hand-written statements first release any credits a v1 render still held and delete its
  job rows). Applied through the direct migrator on 2026-09-22: `db:migrate` failed silently on
  `DROP CONSTRAINT shots_reel_id_reels_id_fk` (the cascading table drop had already taken it),
  fixed with `IF EXISTS`.
  `0026` (the same rebuild) adds the v12 tables on the spec's own vocabulary - 26 enums, `assets`,
  `art_styles` (the 14 presets inserted at its foot, `ON CONFLICT (key) DO NOTHING`), `episode_settings`,
  `reels`, `reel_shots`, `shot_description_parts`, `shot_characters`, `storyboard_sheets`,
  `storyboard_frames`, `clips`, `generations`, `notes`, `view_preferences`, `activity_log` - and the
  scene image + setup-override columns on `scenes`; RLS block hand-written on the `0016` pattern
  (`art_styles` lets every member read a preset, nobody write one). Additive, generated with the
  real env present, applied through the direct migrator on 2026-09-22. `schema/production.ts` names
  the two deviations (`reel_shots`, `scene_node_id`).
- **`env.ts` also exports `modelEnv`** - `GEMINI_API_KEY`, optional, `null` when unset; the only reader is
  `apps/web/lib/production/pipeline/gemini.ts`. The model ids live in `@folio/contracts` (`MODEL_REGISTRY`).
- **`env.ts` also exports `storageEnv`** - the five `R2_*` variables, optional as a block, `null`
  when none is set. The only reader is `apps/web/lib/storage/r2.ts`. And `assistantEnv` -
  `ANTHROPIC_API_KEY`, optional, `null` when unset; the only reader is
  `apps/web/lib/assistant/server.ts`.
- **The ledger's `settled` excludes `reserve` / `release`.** A reservation is closed by a `spend`
  or a `release`; `0007` corrected the `credit_balances` view that double-counted a held one.

## Commands

```bash
pnpm --filter @folio/db db:generate   # write a migration from the schema
pnpm --filter @folio/db db:check      # verify the journal — reads files, never connects
pnpm --filter @folio/db db:migrate    # the only one that needs a reachable database
```

All three need the env vars **present** — `drizzle.config.ts` is evaluated whole. On a bare
checkout `.env` is empty, so `db:check` exits 1 with `env.ts`'s three-problem report. That is a
config failure, not a schema failure; the journal is clean.

**`db:generate` needs a TTY** when one diff drops a table and creates another — it prompts for
rename-or-drop and exits under a non-interactive runner. `0010`/`0011` were produced through
`drizzle-kit/api` from a one-off script ("Timeline route phase" in `docs/build-decisions.md`).

AGENTS.md's `pnpm --filter @folio/db drizzle-kit check` does not run at all
(`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` — not a script name). Use `db:check`.

**`db:migrate` hides the failing statement.** When a migration errors, `drizzle-kit migrate` prints
only Postgres NOTICEs and exits 1 — no query, no message. To see the real error, run
`drizzle-orm/postgres-js/migrator`'s `migrate()` directly from a node one-liner in this directory;
it throws with the failed SQL and the cause. That is how the `0000` ordering bug was found.
