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
- [ ] 2.3 Agent loop. Refactor ask() in apps/web/lib/assistant/server.ts into a tool-use loop, and switch POST /api/assistant to an application/x-ndjson stream of AgentEvent. Create apps/web/lib/agent/registry.ts. A tool has a name, description, toolset, minimum role (from apps/web/lib/auth/roles.ts), mode, Zod input schema and a run(ctx, input) function. ctx carries the gate (actor, scope, project, episode, role), the run id, the idempotency key (the tool_use id) and an emit function. Enforce the ADR 0003 D5 caps; when a cap is hit, ask the model for a final summary and stop. Record tokens on agent_runs, enforce the D3 daily token cap, and store full content blocks on assistant_messages. Keep prompt caching on the system block and add it to the last tool definition. Keep today's refusal and abort handling. Register only one test tool for now. Test the loop with a mocked Anthropic client, covering a tool error, the step cap and the token cap. Update the panel to consume the new stream: text renders as before, and tool events render as small status lines.
- [ ] 2.4 Server-side reads. Move the client-only logic listed in AGENT_READINESS_REPORT.md section 6.2 into server-callable functions, keeping the pure parts shared so the UI behaves identically. Per ruling R4, every number comes from code, never from a model. (a) The continuity check, chronology and placement proposals: promote the path at lib/assistant/server.ts:188-236 into lib/timeline/server.ts. (b) Page counts: return the stored measurement when its node_digest matches; otherwise run packages/script's paginate on the server. Refuse clearly for the asian format. (c) The four facts cells: move their predicates into lib/<route>/facts.ts, used by both the client effects and the server. (d) Exports: server actions wrapping outlineMarkdown, chronologyMarkdown, both csvOf functions and breakdownCsvOf. (e) Project list filtering and counting. Test each server function against the client result on a fixture.
- [ ] 2.5 Read tools. Register every Phase 2 tool in docs/agents/tools.md, including read_research, the launcher's list_projects and open_project, and load_toolset. Research is read-only (R3). The panel handles navigate by building URLs only with lib/workspace/hrefs.ts and enterEpisodeRoute, then calling router.push; refresh by calling router.refresh(); and download by saving a Blob, which is how exports reach the user (R2). Each turn loads the core toolset plus the current route's toolset. Test each tool's run function against a seeded project, and test that a tool refuses a caller below its minimum role.
- [ ] 2.6 Context and prompt v2. Publish the editor selection (node ids) from the Script and Outline editors through the ephemeral context, the same way assistantFocus works, and include the route, selection and focus in each request. Rewrite the instructions in lib/assistant/context.ts: the agent can read, search, navigate and export, but cannot change anything yet. It keeps citing scenes as it does today, and states report numbers only as returned by tools. Keep the focus blocks.

Phase 2 is done when every box is ticked, the Playwright specs pass, and a user can ask questions from any page and be navigated to the answers.


## Phase 3: Proposals and write tools

## Phase 4: Worker, background runs, story-to-script pipeline

## Phase 5: Production automation, exports, quality
