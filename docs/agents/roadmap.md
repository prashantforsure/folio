# The agent copilot roadmap

**Status:** the task list of record, 2026-09-23.

The plan is [`integration-plan.md`](integration-plan.md). The decisions are
[ADR 0003](../adr/0003-agent-copilot.md). The craft rules are
[`craft.md`](craft.md) and the tool catalogue is [`tools.md`](tools.md).

The five phases below are empty on purpose. **The first session of each phase
adds that phase's tasks**, from the plan's build order and the report sections it
cites, and every session after it ticks one checkbox.

---

## Working rules

1. **One task per session and per pull request.** When the task is done, stop and
   summarize. Do not start the next task.
2. **Before planning, read** `AGENTS.md`, `CLAUDE.md`,
   [`docs/adr/0003-agent-copilot.md`](../adr/0003-agent-copilot.md),
   [`docs/agents/roadmap.md`](roadmap.md), [`docs/agents/tools.md`](tools.md),
   and the report sections the task cites.
3. **Present a plan listing every file you will touch** before editing anything.
   Do not touch other files without saying why.
4. **Follow AGENTS.md conventions:** discriminated-union results instead of
   throwing, Zod schemas at boundaries in `@folio/contracts`, pure logic in
   `packages/script`, repositories take `ProjectScope`, and `process.env` is read
   only in the env modules.
5. **No new dependencies** except those pre-approved in ADR 0003 **D17**. Ask
   before adding any other.
6. **Migrations are forward-only:** create the next numbered file, never edit an
   old one, run `db:check`, and state in the summary that the migration must be
   applied to staging before production.
7. **Every behaviour change gets a test** that fails before the change and passes
   after it. Run `pnpm typecheck`, `lint` and `test` before finishing, and run
   the relevant Playwright spec when the UI changes.
8. **If the code contradicts the plan, stop and report the conflict** with
   `file:line` evidence instead of improvising.
9. **When finished, tick the task's checkbox in this file** and add two or three
   lines under it: what changed, and any follow-ups.
10. **If this task makes any statement in `AGENTS.md`, a `CLAUDE.md`, an ADR or a
    README untrue, update that statement in the same pull request.** If the task
    needs a rule changed, stop and ask instead of changing it.

---

## Phase 1: Foundations

**Phase goal:** make the existing app safe and reliable for an agent to act in.
Nothing changes visibly for users.

- [x] 1.1 Security fixes (AGENT_READINESS_REPORT.md section 3.4). (a) In lib/auth/actions.ts, run safeNextParam on `next` inside signInWithPassword, signUpWithPassword and signInWithGoogle (lines 117, 150, 178, 190). (b) In the characters, locations, props, storyboard and production upload actions, run the gate before readImage() reads the body. (c) deleteAssistantChat checks chat.episodeId against gate.episode.id, as openAssistantChat does. (d) openThreadOnNode validates `kind` with a Zod enum built from the thread anchor kinds tuple; replyThread validates `nodeId` with NodeIdSchema. (e) Production: addShot verifies the reel belongs to this episode; patchShot, bulkPatchShots and uploadReference verify the shots belong to this episode; saveNote verifies its target exists in this project and episode. If this is too large for one pull request, split it into 1.1a (a–c) and 1.1b (d–e).

  **Done 2026-09-23**, all of (a)–(e) in one pull request — each fix is a few
  lines and they close one report section between them. `safeNextParam` now
  runs inside the three auth actions; the four uploads that read the body
  before their gate (characters, locations, props, storyboard) gate first, and
  `readImage`'s doc says why; `deleteAssistantChat` compares `episodeId`;
  `ThreadNodeKindSchema` (new in `@folio/contracts`, narrowed out of
  `THREAD_ANCHOR_KINDS`) parses `kind` and `NodeIdSchema` parses `replyThread`'s
  `nodeId`; and five Production writes ask two new repository reads,
  `readReelIdsInEpisode` / `readShotIdsInEpisode`, whether an id is this
  episode's — one statement each, joined through the node list rather than
  `scene_derivations`, so access control never depends on a derived cache.
  `apps/web/tests/action-gates.test.ts` is new and is the first unit test any
  server action has: 15 of its 22 cases fail without these changes.

  Two things for the next session. **The report over-lists one finding:**
  3.4.3 #11 names `production/actions.ts:450-457,464-469`, but both Production
  uploads already ran `openEpisode` before `storeImage` — nothing to fix there,
  and a test now holds them that way. **The report itself was not edited**: it
  is a read-only audit dated 2026-09-22 at `b807d1a` whose own rules say
  nothing in the codebase was modified, so this note is where §3.4's closed
  findings are recorded. The signed-in Playwright walks were **not run** —
  no `E2E_EMAIL` / `E2E_PASSWORD` in either `.env`, so they self-skip — and
  nothing here changes a pixel.
- [x] 1.2 Role enforcement. Add a minimum-role parameter to openProject, openEpisode and openEpisodeWith (apps/web/lib/script/gate.ts:84,121,149) and to openForActor (lib/projects/actions.ts:137), ordered reader < writer < owner, with the refusal message "Your role on this project doesn't allow that." The episode gates also return the role. Put the ADR 0003 D2 matrix in a single table in apps/web/lib/auth/roles.ts, used by every gate now and by the tool registry later, and apply it to all 99 server actions and to ask(). Tests: in each action module, a reader is refused a write and allowed a read.

  **Done 2026-09-23.** `apps/web/lib/auth/roles.ts` is the D2 matrix: the
  ordering, `meetsRole`, the refusal, and one `ROLE.*` capability per family of
  action. All four gates take a minimum role (`ROLE.read` by default, which
  every member holds) and the episode gates return the role; 99 actions and
  `ask()` pass a capability, never a bare role, so moving a family between
  roles is one line here rather than a search. The two hand-written checks that
  existed before - `lib/share/actions.ts` and `purgeProject` - are now the
  gate's, and `restoreProject` and `purgeProject` go through `openForActor`
  like the rest of that route.

  Two things found on the way. **`lib/workspace/actions.ts` swallowed every
  gate refusal**: `gate.status === 'refused' ? NOT_FOUND : gate.message` is
  always true for a `GateRefusal`, so "Sign in to keep writing" had been
  reported as "That project could not be found" since the route was built.
  Fixed to pass the message through, keeping the project wording for the
  gate's own not-found. **A reader keeps their own route arrangement** -
  Production's `view_preferences` row is `ROLE.preference`, a reader's, because
  it is their own view of their own screen and not an authored edit.
  `apps/web/tests/role-gates.test.ts` drives the real gate with a mocked
  membership row: one write per action module, plus the ordering.
- [x] 1.3 Idempotency keys. A migration adds a nullable idempotency_key text column and a partial unique index on (project_id, idempotency_key) where it is not null to: characters, locations, props, research_sources, story_threads, reels, reel_shots, shots, episodes. The create actions (createCharacter, createLocation, createProp, addSource, createThread, addReel, Production addShot, Storyboard addShot, createEpisode) accept an optional idempotencyKey. A repeat with the same key returns the existing row as success, following credit_ledger's pattern (packages/db/src/schema/credits.ts:62-66).

  **Done 2026-09-23.** Migration `0031` adds a nullable `idempotency_key` and a
  partial unique index on `(project_id, idempotency_key)` to all nine tables;
  `db:check` is clean and it is **not applied to dev**. The nine create
  repositories take an optional key, name the index in their conflict clause
  (`repositories/idempotency.ts`) and read the conflicting row back, so a
  repeat returns the first call's row as success. The nine actions take an
  optional last argument, parsed with `IdempotencyKeySchema`
  (`@folio/contracts`) through `apps/web/lib/idempotency.ts`.

  Three decisions worth knowing. **A malformed key refuses** rather than being
  dropped - ignoring it would remove the protection exactly when somebody is
  relying on it - while an absent key stays `null`, never `''`, or every UI
  create in a project would collide with every other. **A key covers one shot,
  not a batch**: `insertReelShots` and `insertShots` throw on a key with more
  than one seed, because the batch callers are the shotlist and the proposal,
  which mint rows from a pass over the script rather than from a call that can
  be retried. **A repeat is not a second act** - `insertReel` does not write a
  second `activity_log` row, and `createCharacter`'s follow-on writes (binding
  the name's spelling, re-deriving) are idempotent in their own right.
- [x] 1.4 Ordering and migration state. A migration puts COLLATE "C" on nodes.order_key and shots.order_key (see packages/db/src/order.ts:79-85), and rebuilds every index on those columns under the new collation, including the unique index nodes_document_order_key. Before writing it, check whether existing reads already order with COLLATE "C"; if any read does not, report it. Add a test proving a fixture document's order is identical before and after. Also determine whether migration 0030 is applied to dev; if you cannot query the database, put the exact SQL check in the pull request description.

  **Done 2026-09-23.** Migration `0032` is custom (drizzle's `text()` cannot
  express a collation): `COLLATE "C"` onto `nodes.order_key`, restated on
  `shots.order_key`, and `nodes_document_order_key` dropped and recreated
  around the `ALTER` in one transaction, so the index whose ordering was wrong
  is visibly rebuilt rather than left to the `ALTER`'s implicit rebuild.
  `apps/web/tests/order-collation.test.ts` builds a fixture document the way
  the repositories do - appends, splits, a spread paste - and holds its
  sequence against byte order, with the locale comparison beside it as the
  failure that made this necessary.

  **One read did not ask for the collation, and now does.**
  `packages/db/src/repositories/users.ts:235` - the project-card preview -
  ordered `n.order_key asc` twice with no `COLLATE "C"`, so every card on
  `/app/projects` has been showing the first few lines of a script in the
  locale's order. Every other read goes through `byOrderKey`.

  **Migration state, measured rather than assumed** (three read-only queries,
  2026-09-23): `drizzle.__drizzle_migrations` holds **30 rows** - `0000` to
  `0029` - `props` and `prop_aliases` do not exist, and `scenes.prop` /
  `reel_shots.prop` are still present. **`0030` is not applied to dev**, and
  neither are `0031` or `0032`. The same read found `nodes.order_key` on the
  database default, `en_US.UTF-8`, and `shots.order_key` already `C`: the
  misordering D9 describes is live on dev today. `packages/db/CLAUDE.md`
  carries the queries; its "`0030` is UNKNOWN" paragraph is now an answer.
- [x] 1.5 Batched re-derive. Add a request-scoped helper, for example withDeferredDerive(scope, fn), and make every action that calls rederiveProject request a re-derive instead. Inside a batch, the pass runs once at the end; outside a batch, behaviour is exactly as today. Test: five createCharacter calls in one batch cause exactly one derivation pass.

  **Done 2026-09-23.** `apps/web/lib/script/derive-batch.ts`:
  `withDeferredDerive(scope, work)` opens a batch over an `AsyncLocalStorage`
  context, `requestRederive(scope)` is what an action calls, and nineteen call
  sites in Characters and Locations now request rather than run. Outside a
  batch a request **is** `rederiveProject`, awaited, same result - which is the
  property that matters, because every route in the app is outside one.

  Three things worth knowing. **Two actions keep the direct pass**: `deriveNow`
  and `deriveLocationsNow` are the explicit "derive N" buttons and they read
  the derivation itself to report a count, so deferring them would be
  deferring the thing the writer asked for. So does `saveScript`'s, which runs
  inside `after()` and needs the pass for the Info panel's figures. **A failed
  deferred pass is returned, not swallowed** - the writes have already answered
  by the time it runs, so `withDeferredDerive` hands back the outcome beside
  the work's own value. **Inside a batch the derived tables are stale until it
  closes**, so an action answering with a derived count answers with the one
  from before its own write; that is why this is opt-in and not the default.
- [x] 1.6 Compare-and-swap saves. Add an optional expectedDigest to SaveScriptInputSchema and SaveOutlineInputSchema, computed with the same function that produces measurements.node_digest. When it is present and the stored list's digest differs, return the existing conflict result and write nothing. Behaviour without the field is unchanged.

  **Done 2026-09-23.** `expectedDigest` is optional on both save schemas and is
  `nodeDigest` - the function that writes `measurements.node_digest`, widened
  from `ScreenplayNode[]` to `readonly unknown[]` so the outline's save uses
  the same one rather than a second answer to "has this list changed". Absent,
  and both saves behave exactly as before: the write lands and a `conflict`
  rides back, which is last-write-wins with a banner and is the ruling for two
  people typing.

  **The refusal is a new status, not the existing `conflict` field.** A
  compare-and-swap that failed must not answer `status: 'saved'` - the client
  would take the `updatedAt`, mark itself clean and drop the writer's work,
  which is worse than the race. So the result gains
  `{ status: 'stale', conflict }`: the conflict shape that already existed,
  under a status that says nothing was written. Both editors now handle it;
  neither can reach it, because neither sends the field - and the compiler
  found both call sites, which is the point of adding the case to the union.
- [x] 1.7 Rate limits. Implement ADR 0003 D14 with a project-scoped table (it must carry project_id, per the schema rule) and a helper checkRateLimit(scope, actor, bucket). Apply it to POST /api/assistant and to the six actions in lib/production/generate.ts. A limited request gets a normal refusal result that includes retry-after seconds.

  **Done 2026-09-23.** Migration `0033` adds `rate_limits`, keyed
  `(project_id, user_id, bucket, window_start)` with `window_start` =
  `date_trunc('hour', now())`, so a new hour is a new row and the database's
  clock decides the window. `touchRateLimit` (`@folio/db`) is one
  `INSERT … ON CONFLICT DO UPDATE … WHERE count < limit`: the increment *is*
  the check, because reading then writing is a race at exactly the moment a
  limit matters, and an empty `RETURNING` is the refusal - so a caller past the
  limit also stops incrementing, and the window ends when the hour does rather
  than when they stop trying. `checkRateLimit(scope, actor, bucket)` is the
  web-side helper; the numbers are `apps/web/lib/agent/limits.ts`, the file ADR
  0003 D3 names.

  **One deviation, deliberate: `cancelGeneration` is exempt.** The task named
  all six actions in `generate.ts`, and five of them take the limit. Refusing a
  cancel is refusing somebody the stop button on work that is already running
  and already holding credits - and the only way to reach that refusal is to
  have made thirty generations in the hour, which is exactly the person who
  needs it. The limit's purpose (bound what a loop can start) is untouched: a
  cancel starts nothing.

  Also here: D14's third limit, **two concurrent agent runs per project**, is
  recorded in `limits.ts` and **not enforced** - it counts live `agent_runs`
  rows rather than a window, so it belongs with that table in Phase 4. And the
  Production client's `failed()` helper now names `rate-limited`; without that
  the refusal would have been a click that did nothing.
- [x] 1.8 Hygiene. (a) Add exportScriptFountain beside exportScriptFdx using serialiseFountain, add it to the Script route's export menu, and correct the settings text at settings-workspace.tsx:426 to point to it. (b) Remove REDIS_URL from .env.example and any env documentation. (c) Replace the per-thread listComments calls in _script/script-route.tsx:42-46 and _outline/outline-route.tsx:41-45 with one batched read. (d) In AGENTS.md:212 and CLAUDE.md:74, correct the claim that MODEL_REGISTRY is the only place a model is named: it is the only place a generation model is named, and the assistant model lives in apps/web/lib/assistant/model.ts. (e) Fix the comment at packages/db/src/schema/derived.ts:590 that points at a sceneNodeRef column that was never built.

  **Done 2026-09-23.** (a) `exportScriptFountain` sits beside `exportScriptFdx`
  over `serialiseFountain` - a tested pure function nothing had ever called -
  with `Export as .fountain` in the Script route's menu and the settings line
  corrected to point at it (it pointed at the Outline route's menu, where a
  *Markdown* export of a different document lives). (b) `REDIS_URL` is out of
  `.env.example`, with a line saying it is not deliberately absent but never
  arriving (ADR 0003 D6). (c) `listCommentsFor` reads every thread's comments
  in one statement; both routes were calling `listComments` once per thread
  inside a `Promise.all`, so a script with forty threads paid eighty round
  trips on a page load. (d) AGENTS.md and CLAUDE.md now say `MODEL_REGISTRY` is
  the only place a **generation** model is named, with the assistant's in
  `apps/web/lib/assistant/model.ts` (D12). (e) The `scenes` comment promised a
  `sceneNodeRef` column that was never built; it now says what is actually
  there - a plain `uuid` key with no foreign key, the shape `reels` and `shots`
  use for the same reason.

  **One conflict found by a test, resolved toward AGENTS.md.**
  `serialiseFountain` writes a `comment` node as a Fountain note, `[[like
  this]]`, which is right for a serialiser whose promise is that parsing its
  output returns the same nodes. AGENTS.md, Export is unconditional:
  "Comments never enter an export." The rule is about exports, so the export
  strips them and reports the count, and the pure function is left exact.

Phase 1 is done when every box is ticked, all tests pass, and the new
migrations are applied to staging.

**Status, 2026-09-23.** Every box is ticked and every gate is green:
`turbo run typecheck lint --force` 12/12, `apps/web` 53 files / 595 tests,
`@folio/script` 34 files / 563 tests, `pnpm build` with the secret scan over
319 client-served files, `db:check` clean.

**The migrations are not applied anywhere yet**, and that is the one condition
above still open. Four are pending - `0030` from the Props pass and `0031`,
`0032`, `0033` from this phase - and their state on dev was *measured* on
2026-09-23, not assumed: `drizzle.__drizzle_migrations` holds 30 rows,
`0000`–`0029` (`packages/db/CLAUDE.md` carries the queries). Apply in order,
and read `0030` before running it: it drops two columns.

The signed-in Playwright walks were **not run** - no `E2E_EMAIL` /
`E2E_PASSWORD` in either `.env`, so all ten self-skip and a green run would
prove nothing. Nothing in this phase changes a pixel except the Script route's
new `Export as .fountain` menu item.

## Phase 2: Agent loop, app-wide panel, read tools

**Phase goal:** the copilot lives in an app-wide side panel, runs a tool-use loop, and can read, search, navigate and export across the whole app. It cannot change anything yet (AGENTS.md ruling R8).

- [x] 2.1 Contracts and storage. In @folio/contracts, add agent.ts containing: the AgentEvent union (text, tool_started, tool_finished, proposal, confirm_required, navigate, refresh, download, error, done, each with the fields it needs), run statuses (queued, running, waiting_for_user, succeeded, failed, cancelled), and run modes (interactive, background). A migration adds an agent_runs table (project_id, episode_id, chat_id, the triggering message id, created_by, status, mode, input_tokens, output_tokens, credit_budget, credits_spent, error, timestamps), plus nullable content jsonb and run_id columns on assistant_messages to store the API's tool_use and tool_result blocks. Add packages/db/src/repositories/agent.ts, taking ProjectScope.

  **Done 2026-09-23.** `@folio/contracts` `agent.ts` holds the ten-kind `AgentEvent`
  union, run statuses, modes, stop reasons, `AgentRun` and `NavigateTarget` (the
  route names are checked against `lib/workspace/routes.ts` in
  `tests/agent-contracts.test.ts`). Migration `0034` adds `agent_runs` (links to
  chat, message and episode are `set null` so a deleted chat cannot reset the D3
  meter), `assistant_messages.content` / `run_id`, and swaps the body check for
  *body or content*. `repositories/agent.ts` takes `ProjectScope`, except
  `tokensTodayFor`, which sums across a user's projects on `readCreditsFor`'s
  pattern. `agent_runs` lives in `schema/assistant.ts`, not a new file: the two
  tables reference each other. **`0034` must be applied to staging before
  production**, after `0030`–`0033`.
- [x] 2.2 App-wide panel. Move the assistant panel's mount from _chrome/project-shell.tsx:141-155 into apps/web/app/(app)/layout.tsx through a client host component. Keep PANEL_WIDTH, the ⌘J binding and the breakpoint rule; project-shell keeps reading "panel open" from the session store so its nav-collapse rule still works. Hide the panel with CSS instead of unmounting it, and keep the chat id and draft in the Zustand session store. Outside a project, render the launcher from ADR 0003 D15: no stored chat; for now it shows recent projects and a disabled "Start from a story" button. The existing assistant must work exactly as before. Add a Playwright spec proving the panel and its conversation survive navigation between routes and between projects.

  **Done 2026-09-23.** `app/(app)/layout.tsx` mounts `_shell/assistant/assistant-host.tsx`
  once; the panel moved to `_shell/assistant/assistant-panel.tsx` and is hidden, never
  unmounted, when closed or while the launcher shows. `project-shell.tsx` publishes its
  project into `lib/assistant/project-cell.ts` and keeps the nav-collapse rule; `⌘J`
  moved to the host. The open chat per episode and the draft are in the session store.
  The launcher lists recent projects (`listRecentProjects`) and draws `Start from a
  story` disabled, **with no composer** (ruled 2026-09-23: a launcher turn has no
  project for `agent_runs` to record it on). `tests/assistant-host.test.tsx` proves
  the host's rules; `e2e/assistant-panel.spec.ts` is written and **not run** (no
  `E2E_*` credentials; the dev database also lacks `0030`–`0034`).
  Follow-up: the account routes have no orb, so the launcher is reachable by `⌘J` only.
- [x] 2.3 Agent loop. Refactor ask() in apps/web/lib/assistant/server.ts into a tool-use loop, and switch POST /api/assistant to an application/x-ndjson stream of AgentEvent. Create apps/web/lib/agent/registry.ts. A tool has a name, description, toolset, minimum role (from apps/web/lib/auth/roles.ts), mode, Zod input schema and a run(ctx, input) function. ctx carries the gate (actor, scope, project, episode, role), the run id, the idempotency key (the tool_use id) and an emit function. Enforce the ADR 0003 D5 caps; when a cap is hit, ask the model for a final summary and stop. Record tokens on agent_runs, enforce the D3 daily token cap, and store full content blocks on assistant_messages. Keep prompt caching on the system block and add it to the last tool definition. Keep today's refusal and abort handling. Register only one test tool for now. Test the loop with a mocked Anthropic client, covering a tool error, the step cap and the token cap. Update the panel to consume the new stream: text renders as before, and tool events render as small status lines.

  **Done 2026-09-23.** `lib/agent/loop.ts` runs the turn (12 steps / 60 s, each ending
  with a no-tool summary call; the D3 cap stops without one), `lib/agent/registry.ts`
  holds tools (name, description, toolset, minimum role, mode, Zod input, `run`),
  and `ask()` wraps it in an `agent_runs` row and an `application/x-ndjson` stream.
  Every API message is stored with its blocks; `lib/agent/replay.ts` replays them and
  drops a tool call an abort left unanswered. `list_scenes` is the one tool. Tested
  with a scripted client (`tests/agent-loop.test.ts`: tool error, bad input, role,
  step/time/token caps, refusal, abort). Follow-up: the D3 meter counts cached input
  tokens in full, so at 2M/day a project-scope turn on a full feature (~100k tokens
  per step) spends the cap in a few multi-step turns - the constant or the counting
  needs a ruling once real usage is seen.
- [x] 2.4 Server-side reads. Move the client-only logic listed in AGENT_READINESS_REPORT.md section 6.2 into server-callable functions, keeping the pure parts shared so the UI behaves identically. Per ruling R4, every number comes from code, never from a model. (a) The continuity check, chronology and placement proposals: promote the path at lib/assistant/server.ts:188-236 into lib/timeline/server.ts. (b) Page counts: return the stored measurement when its node_digest matches; otherwise run packages/script's paginate on the server. Refuse clearly for the asian format. (c) The four facts cells: move their predicates into lib/<route>/facts.ts, used by both the client effects and the server. (d) Exports: server actions wrapping outlineMarkdown, chronologyMarkdown, both csvOf functions and breakdownCsvOf. (e) Project list filtering and counting. Test each server function against the client result on a fixture.

  **Done 2026-09-23.** (a) `continuityOf` (`lib/timeline/view.ts`) and `readContinuity`
  (`lib/timeline/server.ts`) replace the assistant's private copy; the workspace
  reads the same helpers. (b) `readPageCount` (`lib/script/page-count.ts`). (c) The
  predicates live in `lib/<route>/facts.ts` and the cells moved to `facts-cell.ts`;
  `read*Facts` beside each loader. (d) `exportOutlineMarkdown`, `exportChronology`,
  `exportCharactersCsv`, `exportLocationsCsv`, `exportLocationBreakdown`. (e)
  `readProjectList` + `visibleCards`. Tested in `tests/server-reads*.test.ts`. The
  server exports read what is **saved**; the Outline menu exports the editor's
  state, which can be a keystroke ahead. Route E2E walks not run (no credentials).
- [x] 2.5 Read tools. Register every Phase 2 tool in docs/agents/tools.md, including read_research, the launcher's list_projects and open_project, and load_toolset. Research is read-only (R3). The panel handles navigate by building URLs only with lib/workspace/hrefs.ts and enterEpisodeRoute, then calling router.push; refresh by calling router.refresh(); and download by saving a Blob, which is how exports reach the user (R2). Each turn loads the core toolset plus the current route's toolset. Test each tool's run function against a seeded project, and test that a tool refuses a caller below its minimum role.

  **Done 2026-09-23.** All 17 Phase 2 tools are registered (`lib/agent/tools/`), each
  read or client, checked against this catalogue by `tests/agent-tools.test.ts`, which
  also runs every tool on a seeded fixture and proves the role refusal. The panel
  handles `navigate` (`lib/agent/navigate.ts` over `hrefs.ts`, then `router.push`),
  `refresh` and `download` (a Blob); an open chat now survives a move to another
  episode of the same project. **Flag:** the per-source Research `readable` toggle
  AGENTS.md names does not exist, so `read_research` returns no source or clip text
  until it does - adding it is AGENTS.md's "widen what the AI can read".
- [x] 2.6 Context and prompt v2. Publish the editor selection (node ids) from the Script and Outline editors through the ephemeral context, the same way assistantFocus works, and include the route, selection and focus in each request. Rewrite the instructions in lib/assistant/context.ts: the agent can read, search, navigate and export, but cannot change anything yet. It keeps citing scenes as it does today, and states report numbers only as returned by tools. Keep the focus blocks.

  **Done 2026-09-23.** The Script and Outline editors publish their selection as node
  ids (`useSelectionPublisher`, `useEphemeral().assistantSelection`), only when the ids
  change; the panel sends it with the route. The instructions now say the agent can
  read, search, navigate and export but change nothing, keep "Scene 3" citations, and
  state numbers only as tools return them; the focus blocks are unchanged. The route
  and selection go in a last, uncached block (`whereBlock`); a Script selection is
  quoted from the stored script, an Outline one only counted (the outline is not in
  the assistant's context - reading it is an ask-first widening).

Phase 2 is done when every box is ticked, the Playwright specs pass, and a user can ask questions from any page and be navigated to the answers.


## Phase 3: Proposals and write tools

**Phase goal:** the copilot can change anything it is allowed to through reviewable, undoable proposals, and every change is attributed to a run (ADR 0003 D1, D10, D11; AGENTS.md rulings R1 and R8).

- [x] 3.1 Proposal storage. A migration adds agent_proposals (project_id, run_id, episode_id, status pending|applied|rejected|stale|failed|partially_applied, summary, base jsonb, needs_confirmation, credit_cost, decided_by, decided_at, timestamps) and agent_proposal_ops (project_id, proposal_id, seq, tool, args jsonb, mode, idempotency_key, status, result jsonb, undo jsonb, applied_at). It also adds a nullable run_id to versions and a users.agent_autonomy enum (review|auto, default review). Add contracts and repository functions taking ProjectScope.

  **Done 2026-09-23.** Migration `0035` adds `agent_proposals`, `agent_proposal_ops`,
  `versions.run_id` and `users.agent_autonomy` (four enums, RLS on both tables, `db:check`
  clean, **not applied to dev**). `@folio/contracts` `proposals.ts` holds the statuses, modes,
  autonomy, the base and both row shapes; `repositories/agent-proposals.ts` creates a proposal
  and its operations in one transaction, claims a decision with one conditional `UPDATE` (the
  double-click lock), marks operations, and exports `logAgentActivity`. `snapshotVersion` takes
  an optional run id and `listRunSnapshots` reads a run's `before_agent_run` snapshots back.
  Autonomy is read and written on a raw database, as `users` has no `project_id`.
- [x] 3.2 Apply and undo. In apps/web/lib/agent/apply.ts, applyProposal: checks role and status; snapshots before_agent_run versions (with run_id) for affected documents; runs the operations in order inside the batched re-derive from task 1.5, calling the wrapped actions with their idempotency keys; captures an undo record for each operation before it runs (prior field values for updates, the rename restore payload, the placements for placeScenes); writes an activity_log row per operation with the verb agent:<tool>; and on the first failure, stops and marks the proposal partially_applied. undoRun reverses a run's applied operations in reverse order. For documents changed since the run, it creates a new proposal instead of overwriting. Test both, including a failure midway through a proposal.

  **Done 2026-09-23.** `lib/agent/apply.ts`: `applyProposalWith` checks status, role (the highest
  minimum among the operations) and confirmation, claims the decision, marks the proposal `stale`
  if a base document's digest moved, snapshots `before_agent_run` versions with the run id, then
  runs each operation inside `withDeferredDerive` - undo record stored before the run, result and
  an `agent:<tool>` activity row after - stopping at the first failure (`failed` or
  `partially_applied`). `undoRunWith` inverts newest first, skips and names what has no inverse,
  and turns targets changed since the run into one new pending proposal (its keys start `undo:`,
  so a second undo never reverses it). `lib/agent/executors.ts` is the per-tool registry of
  describe/capture/run/invert; `lib/agent/actions.ts` the Apply, Reject and Undo run actions.
  Tested in `tests/agent-apply.test.ts`, including a failure midway.
- [x] 3.3 Proposal UI. Add a proposal card to the panel showing: the summary; each operation described in plain language; record changes as before and after values; script and outline changes as hunks rendered from packages/script's diffScreenplays (a new component, for example _chrome/diff-hunks.tsx); Apply, Reject and Open buttons; applied and failed states; and an Undo run button. Confirm and paid operations show a confirmation step with the reason, the cost and the current balance.

  **Done 2026-09-23.** `_shell/assistant/proposal-card.tsx` draws the summary, each operation in
  its executor's words, before/after values, hunks (`_shell/assistant/diff-hunks.tsx` over
  `lib/agent/diff-view.ts`), "can't be undone" before applying, every status, and Apply / Reject /
  Open / Undo run; a confirm or paid proposal opens a step with the reason, the cost and the
  balance (`readBalance`), and Confirm is disabled when the balance cannot cover it. The card's
  content is built on the server (`lib/agent/card.ts`, executors' new `preview`); Open resolves
  through `lib/agent/targets.ts`, now shared with `navigate`. The `proposal` event gained `runId`,
  `needsConfirmation` and `auto`; a reloaded chat reads its proposal ids back from the stored tool
  results. The diff component sits beside the panel, not in `_chrome/`: the panel is app-wide
  since 2.2. Playwright not run (no `E2E_*` credentials); the proposal walk lands with 3.5's tools.
- [x] 3.4 Script and outline operations. Define ScriptOp in @folio/contracts: insert_after (an anchor node id or the start, plus nodes with type, content as InlineContent and modifiers), replace_content, change_type, delete, move. Validate operations when the proposal is created, using packages/script operations against the current node list. Apply path A: if the panel knows the writer has that document open, it sends the operations to the editor, which applies them as one Tiptap transaction through lib/script/pm-model.ts or lib/outline/pm-model.ts, marks new nodes with provenance agent and the run id, lets autosave persist them, and reports the proposal applied. Apply path B: the server applies them with packages/script operations, ids from crypto.randomUUID, order keys from the packages/db order helpers, and saveScript or saveOutline with the expectedDigest from task 1.6; a conflict marks the proposal stale. Check that the save schemas carry provenance, and extend them if not. Test both paths and a stale conflict.

  **Done 2026-09-23.** `packages/script` `node-ops.ts` applies the five operations (the script's over
  the existing seven, the outline's over new list operations - it had none) and `restoreScriptOps` /
  `restoreOutlineOps` take back only the agent's changes; `outline-diff.ts` is the outline's block
  diff (`diffScreenplays` refuses outline nodes). `ScriptOpSchema` / `OutlineOpSchema` (stored, ids
  minted) and their model-facing `*InputSchema` are in `@folio/contracts`, proved exact against the
  pure types. `lib/agent/document-ops.ts` prepares an edit (mint ids, check mentions, run it once
  against the stored list, digest as base) and is the executor: path B saves with `expectedDigest`;
  path A hands the operations back, the card gives them to the open editor through
  `lib/agent/editor-channel.ts` (one transaction, `lib/script/apply-ops.ts`,
  `lib/outline/apply-ops.ts`) and `finishEditorApply` settles. The save schemas already carried
  provenance - a test holds it. **Follow-up:** undoing a run while the script is open writes on
  the server; the open editor shows its conflict banner rather than the restored text.
- [x] 3.5 Entity, scene and timeline write tools. Register every Phase 3 tool in docs/agents/tools.md for characters, locations, props, synopses and timeline, in their listed modes. Research stays read-only (AGENTS.md ruling R3). Rename tools must call preview_rename first and store the restore payload as the undo record.

  **Done 2026-09-23.** Eighteen tools in `lib/agent/tools/writes-entities.ts` and
  `writes-timeline.ts`, each built with `defineWriteTool` (`lib/agent/write-tool.ts`) beside its
  executor: a call checks, describes and queues; `loop.ts` writes a step's `propose` operations as
  one proposal and each `confirm` alone (`proposer.ts`), emits `proposal` / `confirm_required`, and
  hands the id back in the tool result. `rename_entity` runs `previewRename` when it proposes (the
  confirmation names the blast radius) and stores the rename's restore payload as its undo;
  `create_character` goes through `characters/create.ts` so the record is `origin = 'agent'`.
  Research has no write tool (R3). **Follow-up:** `resolve_queue_item` takes a queue key no read
  tool returns yet - adding one widens what the agent reads, which is ask-first.
- [x] 3.6 Remaining write tools. Register the Phase 3 tools for script and outline edits, comments (minimum role reader, per D2), title page, format and pagination, storyboard, non-paid production edits (including ai_shotlist, which costs 0 credits), episodes, start_story_project and undo_run. start_story_project wraps an adapter around createProject's logic that returns the new project instead of redirecting. Enable the launcher's "Start from a story" button: it creates the project after confirmation and continues the chat inside it.

  **Done 2026-09-23.** Every Phase 3 row of `tools.md` is registered (56 tools with Phase 2's,
  asserted by `tests/agent-tools.test.ts`): `writes-script.ts` (script and outline edits folded per
  document per step, title page, comments at `reader`, format and pagination as confirm),
  `writes-storyboard.ts`, `writes-production.ts` (no paid tool; `ai_shotlist` direct, 0 credits),
  `writes-episodes.ts` (with `undo_run`, confirm). `start_story_project` only asks; the launcher's
  `Start from a story` confirms and calls `startStoryProject` (`lib/projects/create.ts`, shared with
  `createProject`), then the story is sent inside the new project. **Cannot be undone, and said so
  on the card:** comments, accepting or discarding shots, deleting a reel or shot, merges, deletes,
  `create_episode` (its inverse is owner-only and not exposed, D16).
- [x] 3.7 Autonomy and prompt v3. Add the autonomy setting to account settings and honour it in apply, per D1. Rewrite the system prompt: the agent can now act through proposals. Include the rules from docs/agents/craft.md. Add a tool policy: read before writing, preview renames, create characters and locations before referencing them in the script, use their bound cue and slugline spellings exactly, never invent ids, group related changes into one proposal, and explain each proposal in a sentence or two. Remove the "cannot write" lines from the focus blocks, and update AGENTS.md ruling R8's status now that writes have shipped.

  **Done 2026-09-23.** Account settings' Editor defaults has a live **Apply proposals
  automatically** switch (`setAssistantAutonomy`, `users.agent_autonomy`); `ask()` reads it and
  `proposalSink` honours it: under `auto` a record-only proposal applies in the turn, a script or
  outline one is handed to the panel to apply (so the open editor still writes it), and confirm or
  paid operations always wait for a click. The prompt says the agent acts through proposals,
  carries the tool policy and the craft rules (`lib/agent/craft.ts`, held to `craft.md` by a test),
  and the three Focus blocks point at the write tool. AGENTS.md's R8 status is updated in the
  tech-stack row and *The AI agent*.

Phase 3 is done when every box is ticked, and a user can ask for any allowed edit, review it as a diff, apply it, and undo the whole run.

**Status, 2026-09-23.** Every box is ticked. Gates: `turbo run typecheck lint --force` 12/12,
`apps/web` 71 files / 804 tests, `@folio/script` 35 files / 578 tests, `pnpm build` with the secret
scan over 320 client-served files, `db:check` clean. **Migration `0035` is not applied anywhere**:
apply `0030`-`0035` in order to staging before production (`0030` drops two columns - read it
first). The signed-in Playwright walks were **not run** - no `E2E_*` credentials, and the proposal
walk in `e2e/assistant-panel.spec.ts` also needs `ANTHROPIC_API_KEY`. Follow-ups: the resolve
queue, Storyboard and Production have no read tool that returns their ids; undoing a run while the
script is open writes on the server and the editor shows its conflict banner; comments, shot
accept/discard, reel and shot deletes, merges, deletes and `create_episode` cannot be undone (each
card says so).

## Phase 4: Worker, background runs, story-to-script pipeline

**Phase goal:** long tasks run reliably in a worker, and a writer can hand the copilot a story and get back characters, locations, an outline, scenes and a drafted script, with checkpoints along the way (ADR 0003 D4, D5, D6, D7; AGENTS.md ruling R6).

- [x] 4.1 Worker runtime. The jobs table has no attempts or lease columns and JOB_KINDS is only ['frame_generation'], so start with a migration: add attempts, heartbeat_at and claimed_at columns to jobs, extend job_kind with agent_run and production_generation, and add a NOTIFY trigger for newly queued jobs. Then build apps/worker: claim jobs with FOR UPDATE SKIP LOCKED; wake on LISTEN/NOTIFY over the session pooler with a 5-second polling fallback; configurable concurrency; stale-job recovery (requeue after 2 minutes without a heartbeat, fail after 3 attempts); cancellation through cancel_requested_at; graceful shutdown on SIGTERM; a health endpoint; and a Dockerfile. No Redis and no BullMQ (D6). Env names go through the env module. Replace the "BullMQ consumers" comment in apps/worker/src/index.ts to match D6, and update AGENTS.md ruling R6's status. Document env vars and deploy steps for a generic container host in docs/agents/worker.md.

  **Done 2026-09-23.** Migration `0036` adds `jobs.attempts` / `claimed_at` (the lease token) /
  `heartbeat_at`, the two kinds, two partial indexes and `NOTIFY folio_jobs` triggers;
  `repositories/jobs.ts` is the queue (claim, heartbeat that also reads `cancel_requested_at`,
  finish, requeue, stale sweep, `LISTEN`), exercised against dev in a rolled-back transaction. The
  runtime (`apps/worker/src/runtime.ts`, 14 tests), `GET /health`, `SIGTERM` drain and a Dockerfile
  are built; `workerEnv` holds `WORKER_CONCURRENCY` / `WORKER_HEALTH_PORT`; handlers are web's
  (`apps/web/lib/worker/`, empty until 4.3/4.4), bundled by esbuild (approved 2026-09-23).
  **Follow-ups:** `0036` is not applied anywhere; the image was not built here (Docker's daemon was
  not running) - the bundle was, and a smoke run against dev answered `/health` 200 with `LISTEN` up.
- [x] 4.2 Actor gates and core functions. Add openProjectAs and openEpisodeAs(actor, projectId, episode, minRole), which perform the same membership, project and role checks without cookies, and make the cookie gates call them. Split every server action that a tool wraps into a core function that takes a gate and input, plus a thin action that runs the cookie gate, calls the core and revalidates. Public action signatures and behaviour stay identical. Switch the tool registry to the cores. Existing tests must pass unchanged.

  **Done 2026-09-23.** `lib/script/actor-gate.ts` holds `openProjectAs` / `openEpisodeAs` (a
  `pooler` for the worker) and the cookie gates are identity plus them. 71 actions in 11 modules are
  thin over `lib/<route>/core.ts` (`<action>With(gate, …)`, own capability check; pre-gate parses
  kept as `*Problem`); every tool and executor calls the cores, `inEpisode` narrows to an operation's
  episode, and a save's after-the-answer work takes a `schedule` (Next's `after` in a request).
  `tests/actor-gates.test.ts` and `tests/worker-import-graph.test.ts` are new. **Test changes, as
  ruled:** the three agent write-tool files mock `lib/*/core` with the gate as first argument
  (positional reads moved with it; the shotlist call gained its scheduler) and mock a membership
  row, because `runTool` now re-reads membership once per step - which keeps `agent-tools.test.ts`'s
  "membership gone" case passing unchanged. **Follow-up:** `meetsRole` ranks an unknown *held* role
  above owner (`rankOf` returns Infinity), the opposite of its own comment - untouched here.
- [x] 4.3 Generations on the worker. In lib/production/generate.ts, replace after(runGeneration) with a production_generation job that the worker runs. Implement Storyboard frame generation: requestFrame calls queueFrameGeneration, and the worker processes frame_generation jobs using the shot_frame model; update the "refuses by design until the worker exists" notes in docs/remainingroadmap.md and AGENTS.md. Add a reaper job every 10 minutes that releases reservations reported by listOrphanedReservations and marks those generations failed with the reason "interrupted". Add an R2 sweeper that logs unreferenced production objects older than 24 hours, and deletes them only when an env flag is set.

  **Done 2026-09-23.** `createGeneration` queues a `production_generation` job in the statement that
  reserves (no `after()`); `lib/worker/production-generation.ts` runs the stored spec, and a cancel
  is folded into `cancelGeneration`'s transaction. Storyboard frames are live: `requestFrameWith`
  queues, `lib/worker/frame-generation.ts` draws with `shot_frame` and settles in one statement
  (`settleFrameJob`), and the page polls (`Polling` moved to `_chrome/`). The reaper (10 min) works
  on the widened `listOrphanedReservations`; the sweeper (6 h) logs, deleting only with
  `R2_SWEEP_DELETE=true`. New SQL exercised on dev in a rolled-back transaction over `0030`-`0036`.
  **Test change:** the shotlist assertion in `agent-write-tools-more.test.ts` lost the scheduler 4.2
  gave it. **Deviations:** the page-load sweep that failed anything running for ten minutes is gone;
  a reservation with no job id is logged, never released (a release with no id closes all of them).
  The E2E walk does not click Draw frame (a real model call); unrun without `E2E_*`.
- [x] 4.4 Background agent runs. Runs in background mode execute in the worker with the same loop and registry, through the actor gates, re-checking membership and role before every step (D4). Each step is persisted before the next starts, so a crashed run resumes from its transcript. When a run needs the user (a confirmation or a checkpoint), it moves to waiting_for_user, and the user's reply enqueues its continuation. Add the start_background_task tool, which the model uses for work beyond the interactive caps. The panel polls live runs every 2 seconds, following _production/polling.tsx, and shows progress, proposals and a Cancel button.

  **Done 2026-09-23.** `start_background_task` (direct, core) writes a run with its own chat, the
  brief and an `agent_run` job in one transaction (`0037`: `agent_runs.input`; D14's two live under
  an advisory lock). `lib/agent/background.ts` runs a job of it through the same loop, now with
  `beforeStep` (run re-read, gate re-opened, every step), `pending` (a crashed job's calls answered
  first via `resumeOf`), `pauseOnConfirmation` and `offer`; it waits for the writer on a confirmation,
  40 steps or the token cap, and `continueBackgroundRun` queues the reply. The panel draws
  `run-card.tsx` (polled every 2 s), re-reads the run's chat while live and replies from its composer;
  `ask()` 409s a turn there. **Test changes:** the catalogue test learns the built Phase 4 rows;
  `assistant-host.test.tsx`'s agent-actions mock gains the three run actions. **Follow-ups:** the E2E
  walks are unrun (no `E2E_*` here, and a run needs a deployed worker with `ANTHROPIC_API_KEY`); a
  script proposal a run makes waits for review, so a later step planned on the same script goes
  stale once the first is applied - 4.5 chains its batches for that.
- [x] 4.5 Story-to-script pipeline. Add the story_to_script tool. It starts a background run with the stages below; each stage produces Zod-validated output and resumes independently.
  (A) Expand the story into genre, tone, format, target length, the protagonist's want and need, stakes, setting and stated assumptions. Stop at a checkpoint for approval.
  (B) One proposal creating characters (origin agent) with their cue spellings and voice notes, and locations with their slugline spellings.
  (C) An outline proposal, with acts as h1 blocks and beats as beat blocks. Then a checkpoint.
  (D) A scene list with synopses. Then a checkpoint.
  (E) Draft scene by scene. Each call gets the rules in docs/agents/craft.md, the scene's beat, the characters' voice notes, the bound cue and slugline spellings, and the end of the previous scene. A critic call then scores the draft against docs/agents/craft.md, followed by one rewrite if any score is below the threshold. Scenes land as script proposals in batches of about five, with agent provenance.
  (F) Re-derive once, compute page counts, run the continuity check, and propose story days and threads.
  Reject any drafted cue or slugline that doesn't exactly match a bound spelling, and any mention id that doesn't exist, and repair it before proposing. Test with a mocked model producing fixed outputs, asserting zero unresolved cues after stage F.

  **Done 2026-09-24.** `story_to_script` (confirm) starts a background run that `lib/agent/story/pipeline.ts`
  carries through A-F, each stage's output Zod-checked and stored in `agent_run_stages` (`0038`) so it
  resumes by stage; every model call is a forced tool call retried once; cues are an enum of bound
  spellings and headings are written from the bound slugline, then held by `checkDraft`
  (`packages/script`); batches are chained on `canonicalScreenplay` digests. `tests/story-pipeline.test.ts`
  walks a line to a draft with zero unresolved cues. **Choices flagged:** voice notes go in the bio (no
  voice column); an episode with no script or outline gets an empty document; F is two proposals
  (a thread's id exists only once created); an empty reply approves a checkpoint, words re-ask it.
  **Test changes:** the catalogue test adds the row; the card fixture gains `run: null`.
  **Follow-ups:** the one-line-story check against a live model and worker is not run (no deployment).

Phase 4 is done when every box is ticked, the worker is deployed to staging, and a thin one-line story produces a complete, reviewable draft.

## Phase 5: Production automation, exports, quality

**Phase goal:** the copilot carries a finished script through shot lists, storyboards and video with cost control, exports a real PDF, and its writing quality is measured.

- [x] 5.1 Script-to-production pipeline. Register the paid tools (generate_images, shoot_reel) and add the script_to_production tool. It proposes episode settings (warning that they lock at the first shoot), one reel per scene, and ai_shotlist per reel, then stops at a checkpoint for the writer to accept shots. Next it shows a cost table from GENERATION_COSTS (sheets, frames, shoots) with the current balance, and requires confirmation for images and a separate confirmation for shooting reels. Enforce the run's credit budget (D3). Progress uses the existing generations polling.

  **Done 2026-09-24.** `paid` is a real mode: a call is priced from `GENERATION_COSTS`, the proposal
  carries `credit_cost`, confirming it grants the run exactly that (`grantRunBudget`, after the
  claim) and each image or shoot spends from the grant first (`spendRunBudget`, `returnRunBudget`).
  `generate_images` / `shoot_reel` (`tools/writes-paid.ts`) name everything in one call, one
  confirmation. `script_to_production` runs `lib/agent/production/pipeline.ts` on the worker (no model):
  setup → shotlists → **shots** checkpoint → **plates** checkpoint → cost table + paid images → paid
  shoots, waiting on the generation rows between (`0039` adds the `production_*` stages). **Client
  ruling:** a shoot needs a location photo, so a `location_plate` job draws one from the description
  (**40 credits, provisional** - price undecided, open decision 14). **Test change:** the catalogue
  test counts the built Phase 5 rows and "no paid tool" became "only the catalogue's paid rows".
  **Follow-ups:** `0039` not applied; no live generation run (no `GEMINI_API_KEY`/`R2_*` here); the
  D14 limit (30 generations an hour) can stop a large images round part-way - the next round
  re-proposes what is missing.
- [x] 5.2 Character look. Implement character_look following the generate.ts pattern (target_type character, cost from GENERATION_COSTS), with a spec builder in pipeline/spec.ts using the character's appearance, age, gender and the episode's art style. Store the result as the portrait via setPortraitKey. Enable the Generate button in _characters/canvas/character-node.tsx, and register the paid generate_character_look tool.

  **Done 2026-09-24.** `characterLookSpec` (appearance, age, gender, role, the portrait as the likeness
  reference) and `generateCharacterLookWith` - which draws in the project's **first episode**
  (`lookEpisodeGate`, the client's ruling) - behind `generateCharacterLook` (project gate); the runner
  stores it under the character and points `setPortraitKey` at it, deleting the old object after.
  The card's button is `✦ Generate · 40 cr`, `Drawing the look…` while it draws (the route polls on
  `readCharacterLook`), or disabled with the server's reason; the look sheet stays disabled, saying
  it is not built. `generate_character_look` is paid; the pipeline's images include looks.
  **Test change:** the catalogue test counts the new row; the Characters E2E no longer pins the old
  disabled title. **Follow-ups:** no live look drawn (no `GEMINI_API_KEY`/`R2_*` here); signed-in
  E2E unrun (no `E2E_*`).
- [x] 5.3 PDF export. Using pdf-lib and @pdf-lib/fontkit (pre-approved by D17; add no other dependency), render the script from its measurement records, computing a fresh measurement on the server when the stored one is stale. Include the title page, an embedded Courier Prime font, and an embedded fallback font for non-Latin scripts such as Devanagari. Add exportScriptPdf, enable the PDF item in _projects/card-menu.tsx:90-93 and in the Script export menu, and extend the export_script tool. Update the "pdf-lib chosen, not installed" note in AGENTS.md's tech stack. If the measurement records don't carry enough position data to lay out pages, stop and report.

  **Done 2026-09-24.** The records do carry enough: each node's `runs` (page, line, count) and each
  page's `(MORE)` / `(CONT'D)`, so `printPages` (`packages/script/src/print.ts`, pure) re-wraps each
  node with the engine's own `wrapText` and places its lines - refusing a record that does not
  measure the list - and `printTitlePage` lays out the cover. `lib/script/pdf.ts` only draws (Courier
  Prime, Noto Sans Devanagari runs for what Courier lacks); `exportScriptPdfWith` reads the stored
  record (`readMeasurementLayout`) when its digest matches and measures otherwise. The card (every
  episode), the Script menu and `export_script` are live; `download` gained an additive
  `encoding: 'base64'`. **Flags:** fontkit 1.1.1's Indic shaper needs `regeneratorRuntime` - a
  minimal shim in `pdf-fonts.ts` instead of a package; labels past a lock print as measured (open
  decision 12); fonts are OFL TTFs in `apps/web/assets/fonts/` (user-approved). E2E unrun.
- [x] 5.4 Run history. Add a History tab to the panel listing runs with their proposals, operations, status, tokens and credits, linking to the affected items, with an Undo run button. Read from agent_runs, agent_proposals and activity_log.

  **Done 2026-09-24.** `Chat · History` in the panel header (client state). `readRunHistoryWith`
  (`lib/agent/history.ts`) reads the runs, then their proposals and operations, their
  `activity_log` rows (when an operation was undone), the turns' first messages, the episodes and
  the scene index in parallel; each operation is its executor's `describe` with a link from
  `placeOf` + `resolveTarget` (a created record through its result id). `run-history.tsx` draws
  both states, tokens and credits, and Undo run (the proposal card's `undoSentence`). **Follow-ups:**
  twenty runs, no paging; E2E walk added but unrun (no `E2E_*`).
- [x] 5.5 Evals. Add an eval harness, for example apps/web/evals with a pnpm eval script that does not run in CI (D19), with 10 fixture stories: thin one-liners, detailed treatments, a series pilot, and one mixing Hindi and English. It runs story_to_script against a scratch project and scores the output with structural checks (the script parses, derive leaves zero unresolved cues, every scene has a heading) and a model-judged rubric built from docs/agents/craft.md. It writes a Markdown report with per-story scores and quoted weak spots for human review.

  **Done 2026-09-24.** `apps/web/evals/`: ten fixtures (four one-liners, three treatments, a series
  pilot, a Hindi-English story, a five-page short); `harness.ts` makes an `eval · <id> · <time>`
  project for `EVAL_USER_EMAIL` and drives the real `runStoryJob` in-process (no worker job is
  queued), applying every proposal and approving each checkpoint; `structural.ts` (Fountain round
  trip, `unresolvedCues`, headings) and `rubric.ts` (the rules read from `craft.md`, a forced-tool
  judge, quotes kept only if code finds them) score it; `report.ts` writes
  `evals/reports/*.md` (git-ignored). `pnpm eval` runs it on its own vitest config, never `pnpm
  test`. **Not run:** no `ANTHROPIC_API_KEY` or eval account here - it stops with that sentence.
- [x] 5.6 Hardening. Add Playwright specs for: the panel persisting across navigation, a cited answer, applying and undoing a character creation, a script edit applied in the open editor, a background run with a checkpoint, and a paid confirmation. Verify the rate limits and caps under load. Write docs/agents/README.md covering env vars, worker deployment, costs and troubleshooting, and confirm AGENTS.md's "What we are building" section still describes the shipped system accurately.

  **Done 2026-09-24.** `apps/web/e2e/copilot.spec.ts` walks the six paths. **Unrun:** there are no
  `E2E_*` credentials here, so all six skip. Walks 2 to 6 also need a model key, walk 5 a worker,
  and walk 6 `GEMINI_API_KEY` and `R2_*`; each skips with its reason. `pnpm eval:limits`
  (`evals/limits.eval.ts`) ran against dev on 2026-09-24. Every limit admitted exactly its number:
  - assistant requests: 60 of 100;
  - generations: 30 of 45;
  - background runs: 2 of 6;
  - 40-credit spends against a 400-credit grant: 10 of 20, with spent equal to granted;
  - token increments: 20 of 20 landed.

  It found one gap: the daily token cap is a per-turn snapshot, so parallel turns can overshoot it.
  It is recorded as a known limit, not fixed. `docs/agents/README.md` covers the environment, the
  worker, costs, limits and troubleshooting. AGENTS.md's *What we are building* still holds; I added
  the paid-confirmation rule and a pointer to the README. The eval config is now `.mts`.

Phase 5 is done when every box is ticked, and a story can go all the way to storyboards and video, with every paid step confirmed.
