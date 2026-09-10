# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read AGENTS.md first

[AGENTS.md](AGENTS.md) is the contract for this project — tech stack, domain rules, exception
tables, conventions, feature workflow, validation, and the open-decisions table. Read it in full
before touching anything; it is not summarised here and this file does not override it.

The short version of why it is written the way it is: **the script is a typed node list and the
only hand-authored artefact.** Scenes, characters, locations, page counts, threads and shot lists
are derived views. Most real bugs in this codebase will be some other surface quietly becoming
authoritative.

This file covers what AGENTS.md does not: what is actually built, how to run it, and how the
pieces of `packages/script` fit together.

## Repository state

Phase 1 is done — pnpm/Turborepo workspace, the lint contract, and the node model plus the seven
operations in `packages/script`, with 87 tests.

Everything else is a deliberate placeholder. [@folio/contracts](packages/contracts/src/index.ts),
[@folio/db](packages/db/src/index.ts), [@folio/ui](packages/ui/src/index.ts) and
[worker](apps/worker/src/index.ts) each export one `PACKAGE_NAME` constant and nothing else. They
are empty *on purpose* and each header comment says why — no drizzle config, no migration, no
design token, no queue. [apps/web](apps/web/app/page.tsx) is a placeholder page so `next build`
has a route. The first migration belongs to the first vertical slice, not to the scaffold.

Not yet written in `packages/script`, and not blocked on anything: the parser, the serialiser,
derivation, pagination, Fountain.

Do not create `apps/sync/`. AGENTS.md defers it explicitly.

## Commands

```bash
pnpm typecheck            # tsc --noEmit across 6 packages
pnpm lint                 # eslint, including //#lint:root for eslint.config.mjs itself
pnpm test                 # only @folio/script and web have test scripts
pnpm build                # only web has a build script
pnpm test:e2e             # playwright; needs `pnpm --filter web exec playwright install chromium` first

pnpm --filter @folio/script test                                   # one package
pnpm --filter @folio/script test --coverage                        # note: no `--` (see below)
pnpm --filter @folio/script exec vitest run src/identity.test.ts    # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test by name
pnpm --filter web dev                                              # next dev
```

### Four traps in the validation commands

1. **Turbo replays cached logs, and the replay is indistinguishable from a run.** `>>> FULL TURBO`
   on the summary line means nothing executed — you are reading a recording, complete with test
   counts and timings from an earlier machine state. Before reporting a suite as passing, force it:
   `pnpm exec turbo run test --force`. AGENTS.md: "Never describe a suite as passing without having
   run it."
2. **`pnpm --filter web test` currently fails on a fresh run** with `ERR_REQUIRE_ESM` out of jsdom's
   `html-encoding-sniffer`. Local Node is v22.5.1; `engines` requires `>=22.12.0 <23.0.0` and
   [.npmrc](.npmrc) sets `engine-strict=false`, so install only warns. Node ≥22.12 is the fix. CI
   takes its version from [.nvmrc](.nvmrc) and does not hit this. The `@folio/script` suite runs in
   a `node` environment and passes fresh.
3. **The coverage command in AGENTS.md's Validation section silently does nothing.**
   `pnpm --filter @folio/script test -- --coverage` forwards `--` and `--coverage` to vitest as
   filename filters: the whole suite runs, no coverage table prints, exit code 0. Drop the `--`.
4. **A short coverage table is not a short run.** The v8 text reporter lists only files with
   uncovered lines, so most files being absent means they are at 100%.

## packages/script — the pure core

The only package with real code, and the only one whose design needs explaining. Every file opens
with a header comment naming the AGENTS.md rule it implements; read those before changing anything.

**Nothing throws.** [result.ts](packages/script/src/result.ts) — every fallible function returns
`Result<T, E>`. A malformed heading, a cursor inside a mention, a page number arriving over the
wire: all *data* in the return type, never an exception.

**Content is runs, not a string.** [inline.ts](packages/script/src/inline.ts) — `InlineContent` is
a list of text runs and mentions, because an `@mention` is a structural reference to a record id,
which is what lets a character discussed in action but never speaking still get a record. A mention
is an atom: `contentLength` counts it as 1. That unit — the **anchor unit** — is what every offset
in an identity event is expressed in.

**Two closed unions with no shared member.** [node.ts](packages/script/src/node.ts) holds the eight
screenplay types, [outline.ts](packages/script/src/outline.ts) the seven outline blocks, and
[document.ts](packages/script/src/document.ts) is the tagged pair over one storage table. They share
no block type — not even `action`/`body`, which are the same shape — because sharing one is the
first step back toward a single widened union. Each union carries a `*_TYPE_COVERAGE` `Record` that
stops compiling if the union and the runtime tag set drift; that is where a ninth type breaks first.

**The page ban is enforced twice, from one source.** `PAGINATION_FIELDS` in node.ts feeds both
halves: `NoPagination` makes each field `?: never` (stronger than omitting it, which only trips the
excess-property check on fresh object literals), and [read.ts](packages/script/src/read.ts) turns
the same tuple into a runtime rejection — so a page number cannot ride in on a database row, an
import or an agent proposal either.

**Reading is strict.** read.ts rejects unrecognised fields rather than ignoring them,
first-failure-wins, with a dotted path to the defect. The consequence is deliberate: adding a field
to a node is a breaking wire change, and AGENTS.md already requires an ADR to change the node schema.

**Comments are filtered in exactly one place.** [stream.ts](packages/script/src/stream.ts).
`RenderableNode` is `Exclude<ScreenplayNode, CommentNode>`, so "I forgot to filter comments" is a
compile error at the consumer rather than a page-count bug three routes away.

**Operations return an `Edit`, never a bare node list.** The least guessable thing in the codebase.
[edit.ts](packages/script/src/edit.ts) and [operations.ts](packages/script/src/operations.ts): every
operation returns `{ nodes, identity, dropped }`, where `identity` is a list of `created` /
`retired` / `restored` / `split` / `merged` events, and `dropped` reports attributes an operation
could not carry across (a cue's delivery modifiers have nowhere to go on an Action).
`packages/script` cannot reach the comment and proposal rows anchored to node ids, so it reports
what happened to the ids and a project-scoped repository in `packages/db` replays it. Flatten that
return shape and reviewer comments silently re-point at someone else's line.

**The package cannot mint an id.** No `Math.random()`, no `crypto`, no `Date.now()` — so every
operation that creates a node takes its ids from the caller (`tailId`, `freshIds`). This is a
consequence of purity, not a convenience, and it is the first rule someone will be tempted to weaken.

Identity rules the operations implement, per [ADR 0001](docs/adr/0001-node-identity.md): split is
head-wins with anchors past the split point re-pointed at the tail; merge is first-wins with a
tombstone; paste preserves ids within a document when absent and mints across one; delete tombstones
and an id is never reused; reorder and type change preserve every id.

**Ids are branded strings with no format.** [ids.ts](packages/script/src/ids.ts) — the only thing
asserted about an id anywhere in the package is that it is non-empty, because the shape has not been
ruled on. Do not codify a format here without resolving that.

## Enforcement lives in the config, not in review

[eslint.config.mjs](eslint.config.mjs) is where AGENTS.md becomes executable. Everything is an
error, never a warning. Two groups: the purity boundary around `packages/script` (no node builtins,
React, Next, Drizzle, Zod, Supabase, BullMQ, sibling workspace packages or CSS; no
`fetch`/`process`/`window`/`crypto` globals; no `Date.now`, `Math.random`, `new Date()`), and the
repo-wide ban list encoding AGENTS.md's "Deliberately not using" table — icon libraries, opinionated
component libraries, the Supabase JS client outside auth/storage, hardcoded hex, Tailwind's `dark:`
variant and its cool-toned `gray`/`slate` scales, default exports, and `as unknown as`.

Two things about that file:

- **Exemptions are declared ahead of the directories that need them.** `packages/ui/src/tokens/**`
  (the one place a hex may be written) and `apps/web/lib/auth|storage/**` do not exist yet. Creating
  those directories should not require a lint-config change.
- **Flat config is last-match-wins per rule.** The config-file block sits *after* the purity block
  on purpose, so `packages/script/vitest.config.ts` gets the default-export exemption. Reordering
  blocks silently changes what is enforced.

[tsconfig.base.json](tsconfig.base.json) turns on `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. That is why `nodes[index]` is followed by an `if (node === undefined)`
guard that looks redundant and is not. Do not delete those.

**`pnpm typecheck` is also a test suite.**
[type-guarantees.test.ts](packages/script/src/type-guarantees.test.ts) asserts with
`@ts-expect-error` — typecheck fails with "Unused '@ts-expect-error' directive" the moment a
compile-time guarantee starts compiling. A typecheck error in that file is the guarantee doing its
job; fix the model, not the directive.

Property tests use fast-check via
[src/testing/arbitraries.ts](packages/script/src/testing/arbitraries.ts), which is deliberately not
exported from the barrel — shipping it would put fast-check on the public surface of a package whose
promise is zero runtime dependencies.

## Docs

- [AGENTS.md](AGENTS.md) — the contract. Its *When to ask first* list and *Open decisions* table are
  load-bearing.
- [docs/adr/0001-node-identity.md](docs/adr/0001-node-identity.md) — node identity under split,
  merge and paste. **Read the preamble.** The decision was delegated to the implementer rather than
  ruled on with product context, is recorded as reversible, and AGENTS.md still lists open decision
  1 as open on purpose. New ADRs start from [0000-template.md](docs/adr/0000-template.md).
- [docs/build-decisions.md](docs/build-decisions.md) — decisions too small for an ADR. Currently one
  pagination stub, kept so an anchor the route doc already links to resolves.

## The design bundles

`docs/ui design/` holds one `.dc.html` per route, `screenshots/*.png`, and a
[README.md](docs/ui%20design/README.md) covering shell layout, tokens, type scale, geometry and
interactions.

- **Read the `.dc.html` files as source text** for exact hex values, pixel values and copy. They do
  not render — `support.js` is a generated mock runtime (`<x-dc>`, `{{ holes }}`, `<sc-for>`) that
  expects a `window.React` the route files never load. Use `screenshots/` for the visual read.
- **Never port `support.js` or the `<x-dc>` markup.** Prototype scaffolding.
- Where two bundles disagree on chrome,
  [Route - Script.dc.html](docs/ui%20design/Route%20-%20Script.dc.html) wins. The two
  `Screenwriting App*.dc.html` shell files are an older generation with stale palette, radii and
  route ids — read them only for the command palette and the all-projects list.
- The README now carries its own **"The bundles show / Build instead"** reconciliation table near the
  end, and has been brought in line with AGENTS.md: accent is terracotta (`oklch(0.50 0.17 27)`,
  with the violet marked stale), no icon library, `film | series` only, credits in the Production
  header rather than a sidebar card. Build the right-hand column; do not re-resolve these by reading
  a bundle.
- **Two rows of that table are still genuinely open**, and neither is resolvable by inference: *which
  pass you are in* — the README's frontend-only pass against local TypeScript fixtures, or
  AGENTS.md's schema-first feature workflow — and *12 vs 6 lines per inch* on the sheet. Ask.
- `docs/ui design/original-spec/`, referenced by the README's file map, is **not in this repo.** The
  bundles and AGENTS.md are the only available sources.
- Density is deliberate. 11–13px chrome type is correct; do not raise it to a 14/16px web default.
  Copy is final; do not paraphrase labels or empty states.

## Working here

- **Escalate the open decisions, do not resolve them.** Nine are unresolved in AGENTS.md and several
  block whole routes.
- **Adding any dependency requires approval, every time.** `packages/script` takes zero new runtime
  dependencies.
- A route is not done without both states (populated and empty) and both themes.
- Report literally: paste failing output, name assumptions where you made them, and flag any rule in
  AGENTS.md you were tempted to break.
