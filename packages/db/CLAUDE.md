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
- **Migrations `0000`–`0029` are applied to the dev Supabase project** and are forward-only.
  **`0030`, `0031` and `0032` are NOT applied** — measured, not assumed, on **2026-09-23** by
  reading the database: `drizzle.__drizzle_migrations` holds 30 rows (`0000`–`0029`), `props` and
  `prop_aliases` do not exist, and `scenes.prop` / `reel_shots.prop` are still there, which `0030`
  drops. The same read found `nodes.order_key` on the **database default collation**
  (`en_US.UTF-8`) and `shots.order_key` already `C`, which is exactly the split `0032` closes.
  `0030` matters more than the usual pending migration because **it drops two columns**. The check
  is three read-only queries and is worth re-running rather than trusting this paragraph:

  ```sql
  select count(*) from drizzle.__drizzle_migrations;                 -- 30 = 0000..0029
  select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('props', 'prop_aliases');
  select table_name, collation_name from information_schema.columns
    where table_schema = 'public' and column_name = 'order_key';
  ```
  (`0017` and `0018` went in one `db:migrate` run on 2026-09-16: drizzle-kit applies every
  pending journal entry, there is no one-at-a-time; `0019` followed in its own run.)
  `0000` was reordered once, before it had ever run anywhere (the shell routes pass, git
  history); `0010` is the sanctioned `DROP TABLE beats`, alone in its file;
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
  the two deviations (`reel_shots`, `scene_node_id`). `0027` adds `reel_shots.reference_asset_ids` (the
  drawer's References `＋`, ruled 2026-09-22); `0028` widens `duration_s` from the preset list to any
  whole second 1–15 (the timing bar's drag lands on 6 s and 7 s). Both additive, both applied.
  `0029` (the account routes pass, 2026-09-22) adds two authored columns to `projects`:
  `logline` (the writer's sentence about the project, printed on its card) and `archived_at`
  (the second soft state — archived is out of the way, trashed is deleted, and a project may be
  both, which is why it is a column rather than a value in `trashed_at`). Additive, generated
  with the real env present, applied to dev through `db:migrate` on 2026-09-22 (it went in clean;
  the two `ADD COLUMN`s touch no existing row, and the 124 projects on dev read back with both
  columns null).
  `0030` (the Props route) adds `prop_status`, `props` and `prop_aliases` - both AUTHORED, and
  the first pair of record tables here with **no derived half at all**: nothing in a node list is
  a prop, so there is no `prop_derivations`, no tally table and no resolve queue, and what the
  script says about one is read at request time (`@folio/script`, `props.ts`) and never stored.
  `prop_aliases` is `location_bound_sluglines` **minus its unique-per-project index**: a slugline
  resolves to one set, but a prop alias resolves nothing - it only makes a line of action worth
  quoting - and two props may both be "the bag". It also swaps `scenes.prop` and
  `reel_shots.prop` (free text, both holding **zero rows**) for `prop_id uuid references
  props(id) on delete set null`, so Props is authoritative for a prop. Generated through
  `drizzle-kit/api` in **two prompt-free diffs** from a one-off script (the `0024` method: a
  same-table `DROP COLUMN prop` + `ADD COLUMN prop_id` makes both `db:generate` and the API
  prompt "is `prop_id` `prop` renamed?" and exit without a TTY, so `0029` -> an intermediate
  snapshot with the two `prop` columns absent -> the schema). The two old columns are dropped at
  the foot of the file, after their replacements exist. RLS block hand-written on the `0022`
  pattern. `db:check` clean. **Not applied to dev by the pass that wrote it, and its state since is
  UNKNOWN** (see the top of this list) - run `db:migrate`, or the direct migrator if it fails
  silently, and check first: it drops two columns.
  `0031` (the copilot's foundations, roadmap task 1.3) adds a nullable `idempotency_key` and a
  **partial** unique index on `(project_id, idempotency_key)` to nine tables - `characters`,
  `locations`, `props`, `research_sources`, `story_threads`, `reels`, `reel_shots`, `shots`,
  `episodes`. `credit_ledger`'s pattern, one step further: the ledger takes a unique violation as
  success, and these read the conflicting row back and return it, so a retried create answers with
  what the first call made. Nullable and partial because every UI create passes no key and two
  clicks must still mean two records; `NULL` is never equal to `NULL`, so those rows never
  collide. The conflict clause names the index (`onIdempotencyKeyConflict`,
  `repositories/idempotency.ts`) rather than being bare - an untargeted one would swallow a
  duplicate episode slug too. Purely additive, `db:check` clean, **not applied to dev**.
  `0032` (the copilot's foundations, roadmap task 1.4) is a **custom** migration - drizzle's
  `text()` cannot express a collation - putting `COLLATE "C"` on `nodes.order_key`, restating it on
  `shots.order_key` (`0006` set that one by hand), and dropping and recreating
  `nodes_document_order_key` around the `ALTER` so the index a reader cares about is visibly
  rebuilt. ADR 0003 **D9** and the incident at `src/order.ts:64-85`: the read-side half shipped
  with that incident (`byOrderKey`), and this is the half it named. Measured before writing it:
  `nodes.order_key` is on the database default (`en_US.UTF-8`) on dev today, so the misordering is
  live. No value changes; `db:check` and `db:generate` see no diff either way.
  `0033` (the copilot's foundations, roadmap task 1.7) adds `rate_limit_bucket`
  (`assistant | generate`) and `rate_limits` - one fixed-window counter keyed
  `(project_id, user_id, bucket, window_start)`, ADR 0003 **D14**. AUTHORED by
  the request it counts. Postgres and not Redis for D6's reasons: a second
  store is a dependency decision, and a fixed window is a counting query.
  `window_start` is `date_trunc('hour', now())` and part of the key, so a new
  hour is a new row rather than a reset and two web processes with different
  clocks agree on the window. D14's third limit - two concurrent agent runs -
  is not here: it counts live `agent_runs` rows, not a window. RLS block
  hand-written on the `0022` pattern; **not applied to dev**.
  `0034` (the copilot's agent loop, roadmap task 2.1) adds `agent_run_status`, `agent_run_mode` and
  `agent_runs` - one row per agent task, AUTHORED by the request that runs it: chat, triggering
  message, actor, status, mode, input / output tokens, credit budget (default **0**, ADR 0003 D3)
  and spend. Its chat, message and episode links are **`set null`**, not cascade: the row is also
  the D3 token meter, and deleting a chat must not reset a writer's daily allowance. It adds
  `assistant_messages.content` (jsonb, the API's `tool_use` / `tool_result` blocks, replayed next
  turn) and `run_id`, and swaps the body check for **body or content** - a turn that is only a tool
  call has no text. `tokensTodayFor` (`repositories/agent.ts`) is the one function there that takes
  a raw database, on `readCreditsFor`'s reasoning: the cap is per user across projects. Generated
  by `db:generate` (no prompt - nothing renamed), RLS block hand-written on the `0033` pattern,
  `db:check` clean; **not applied to dev**.
  `0035` (the copilot's proposals, roadmap task 3.1) adds four enums, `agent_proposals` (a
  reviewable group of agent changes per run: status, summary, the `base` it was planned against -
  document ids and node digests, for ADR 0003 D10's compare-and-swap - `needs_confirmation`,
  `credit_cost`, who decided) and `agent_proposal_ops` (one tool call each, in `seq` order: args,
  mode, the `tool_use` id as `idempotency_key` - unique per project - status, result, undo), plus
  `versions.run_id` (the run a `before_agent_run` snapshot belongs to, `set null`) and
  `users.agent_autonomy` (`review` default | `auto`, D1). `claimProposal` is the double-click lock:
  one conditional `UPDATE` stamps `decided_at` only while it is null. `logAgentActivity` is the
  exported `activity_log` writer the agent uses (Production's stays module-private). Purely
  additive, generated by `db:generate` (no prompt), renamed from drizzle's random tag, RLS block
  hand-written on the `0034` pattern, `db:check` clean; **not applied to dev**.
- **`src/seed/production.ts` is the one seed** (`pnpm --filter @folio/db seed:production -- --user <email>`,
  launched by `scripts/seed-production.mjs` through drizzle-kit's own `tsx`): a "Monsoon Line" series
  in every state the v12 mockup draws; a re-run bins the previous one of that title and writes a
  fresh one. Portraits and the plate are 1×1 PNGs put to R2 when `R2_*` is set, skipped otherwise.
  Dev only: the script goes in through the app's own import and derivation path, the Production
  rows are written to the tables directly.
- **`env.ts` also exports `modelEnv`** - `GEMINI_API_KEY`, optional, `null` when unset; the only reader is
  `apps/web/lib/production/pipeline/gemini.ts`. The model ids live in `@folio/contracts` (`MODEL_REGISTRY`).
- **`env.ts` also exports `storageEnv`** - the five `R2_*` variables, optional as a block, `null`
  when none is set. The only reader is `apps/web/lib/storage/r2.ts`. And `assistantEnv` -
  `ANTHROPIC_API_KEY`, optional, `null` when unset; the only reader is
  `apps/web/lib/assistant/server.ts`.
- **Round trips are the cost model, and this package is where they are spent.** The dev database
  is a Supabase pooler at roughly 400 ms with **`prepare: false`** ([client.ts](src/client.ts)), so
  a parameterised statement costs **two round trips and cannot be pipelined**. The cost of a query
  path is its **statement count, not its row count**: fold work into an existing statement, or
  defer it. A sequential `await` added to a read here is ~400 ms on somebody's page —
  `readProductionEpisode` has three such layers and is why `revalidatePath` had to be banned on
  that route. `apps/web/CLAUDE.md` says the same thing for the save path, but that file does not
  load when you are working in here.
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
`drizzle-kit/api` from a one-off script (the Timeline route pass), as `0024` was.

`pnpm --filter @folio/db drizzle-kit check` does not run at all
(`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` — not a script name). Use `db:check`.

**`db:migrate` hides the failing statement.** When a migration errors, `drizzle-kit migrate` prints
only Postgres NOTICEs and exits 1 — no query, no message. To see the real error, run
`drizzle-orm/postgres-js/migrator`'s `migrate()` directly from a node one-liner in this directory;
it throws with the failed SQL and the cause. That is how the `0000` ordering bug was found.
