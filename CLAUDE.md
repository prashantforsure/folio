# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read AGENTS.md first

[AGENTS.md](AGENTS.md) is the contract — stack, domain rules, exception tables, conventions,
feature workflow, open decisions. Read it in full. It is not summarised here and this file does not
override it.

Why it reads the way it does: **the script is a typed node list and the only hand-authored
artefact.** Scenes, characters, locations, page counts and shot lists are derived views. Most real
bugs here will be some other surface quietly becoming authoritative.

## Repository state

Phases 1–3 are done: the workspace, the lint contract, the node model plus seven operations, and
script interchange — Fountain both ways, FDX import — all in `packages/script` (265 tests).
[@folio/contracts](packages/contracts/src/index.ts),
[@folio/db](packages/db/src/index.ts), [@folio/ui](packages/ui/src/index.ts) and
[worker](apps/worker/src/index.ts) each export one `PACKAGE_NAME` and nothing else — empty on
purpose, each header says why. [apps/web](apps/web/app/page.tsx) is a placeholder page so
`next build` has a route. No migration, no design token, no route yet.

`importFinalDraft` takes an **already-parsed XML tree**, not a string, so the mapping stays pure and
the caller owns the XML parse — [fdx.ts](packages/script/src/fdx.ts) names the exact
`fast-xml-parser` options it expects. That dependency is unapproved and in no `package.json`, so
nothing can call FDX import yet.

Unwritten and unblocked: derivation, pagination, FDX export.

Do not create `apps/sync/`.

## Commands

```bash
pnpm typecheck            # 6 packages
pnpm lint                 # includes //#lint:root for eslint.config.mjs itself
pnpm test                 # only @folio/script and web have test scripts
pnpm build                # only web has a build script
pnpm test:e2e             # needs `pnpm --filter web exec playwright install chromium` first

pnpm --filter @folio/script test --coverage                        # note: no `--`
pnpm --filter @folio/script exec vitest run src/identity.test.ts    # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test
```

Three traps, all of which produce a false pass:

1. **Turbo replays cached logs indistinguishably from a run.** `>>> FULL TURBO` means nothing
   executed — the test counts you are reading are a recording. Force it before reporting a suite as
   passing: `pnpm exec turbo run test --force`.
2. **`pnpm --filter web test` fails on a fresh run** — `ERR_REQUIRE_ESM` from jsdom. Local Node is
   v22.5.1, below the `>=22.12.0` in `engines`; `.npmrc` sets `engine-strict=false` so install only
   warns. Node ≥22.12 fixes it. CI reads [.nvmrc](.nvmrc) and does not hit it.
3. **AGENTS.md's own coverage command does nothing.** `test -- --coverage` passes both args to
   vitest as filename filters: suite runs, no table, exit 0. Drop the `--`.

## packages/script — the pure core

The only package with real code. **Every file opens with a header comment naming the AGENTS.md rule
it implements and why the shape is what it is — those comments are the design docs, read them
before changing anything.** The cross-file facts none of them states alone:

- **Nothing throws.** Every fallible function returns `Result<T, E>`; a malformed heading is data.
- **Operations return `{ nodes, identity, dropped }`, never a bare node list.** The least guessable
  thing in the codebase. `packages/script` cannot reach the comment and proposal rows anchored to
  node ids, so it reports what happened to the ids and a repository in `packages/db` replays them.
  Flatten that shape and reviewer comments silently re-point at someone else's line.
- **It cannot mint an id.** No entropy, by design — callers supply `tailId` / `freshIds`.
- **The page ban is enforced twice from one `PAGINATION_FIELDS` tuple**: `page?: never` at compile
  time, rejection at the wire in `read.ts`. Reading is strict, so adding a field to a node is a
  breaking wire change — which needs an ADR anyway.
- **Screenplay and outline are separate closed unions sharing no member.** `*_TYPE_COVERAGE`
  records stop compiling if a union and its runtime tag set drift.
- Identity rules per [ADR 0001](docs/adr/0001-node-identity.md): split head-wins, merge first-wins
  with a tombstone, paste preserves ids within a document and mints across one, delete tombstones,
  reorder and type change preserve every id.

## Enforcement is in the config, not in review

[eslint.config.mjs](eslint.config.mjs) makes AGENTS.md executable — the purity boundary around
`packages/script` plus the repo-wide "Deliberately not using" ban list, as errors carrying their own
rationale. Two gotchas: exemptions are pre-declared for directories that do not exist yet
(`packages/ui/src/tokens`, `apps/web/lib/auth|storage`), and flat config is last-match-wins, so
block order is load-bearing.

[tsconfig.base.json](tsconfig.base.json) sets `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` — the `if (node === undefined)` guard after an index lookup is
required, not redundant.

**`pnpm typecheck` is also a test suite.**
[type-guarantees.test.ts](packages/script/src/type-guarantees.test.ts) asserts with
`@ts-expect-error`. A typecheck failure there is the guarantee working; fix the model, not the
directive.

## The design bundles

`docs/ui design/` — one `.dc.html` per route, `screenshots/`, and a
[README.md](docs/ui%20design/README.md).

- **Read the `.dc.html` files as source text** for exact hex, px and copy; they do not render
  (`support.js` is a mock runtime expecting a `window.React` that never loads). Use `screenshots/`
  for the visual read. **Never port `support.js` or the `<x-dc>` markup.**
- [Route - Script.dc.html](docs/ui%20design/Route%20-%20Script.dc.html) wins on chrome. The two
  `Screenwriting App*.dc.html` shells are an older generation — stale palette and route ids.
- The README self-reconciles now, in its own "bundles show / build instead" table: terracotta accent,
  no icon library, `film | series`, credits in the Production header. Build the right-hand column.
  **Two rows stay open** — which pass you are in (frontend-only fixtures vs AGENTS.md's schema-first
  workflow), and 12 vs 6 lines per inch. Ask; they are not resolvable by inference.
- `original-spec/`, referenced by the README's file map, is not in this repo.
- Density is deliberate: 11–13px chrome type is correct. Copy is final — do not paraphrase.

## Working here

- **Escalate the nine open decisions; do not resolve them.** Several block whole routes. Same for
  [ADR 0001](docs/adr/0001-node-identity.md) — read its preamble: that ruling was delegated rather
  than reasoned out with product context, and is recorded as reversible.
- **Any dependency needs approval, every time.** `packages/script` takes zero runtime dependencies.
- A route is not done without both states and both themes.
- Report literally: paste failing output, name assumptions where you made them, and flag any rule
  you were tempted to break.
