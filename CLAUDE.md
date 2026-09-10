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

Phases 1–4: the workspace, the lint contract, the node model plus seven operations, script
interchange (Fountain both ways, FDX import) and derivation — all in `packages/script`, 300 tests
across 15 files. [@folio/contracts](packages/contracts/src/index.ts),
[@folio/db](packages/db/src/index.ts), [@folio/ui](packages/ui/src/index.ts) and
[worker](apps/worker/src/index.ts) each export one `PACKAGE_NAME` and nothing else — empty on
purpose, each header says why. [apps/web](apps/web/app/page.tsx) is a placeholder page so
`next build` has a route. No migration, no design token, no route yet.

`importFinalDraft` takes an **already-parsed XML tree**, not a string, so the mapping stays pure and
the caller owns the XML parse — [fdx.ts](packages/script/src/fdx.ts) names the exact
`fast-xml-parser` options it expects. That dependency is unapproved and in no `package.json`, so
nothing can call FDX import yet; the tests read real `.fdx` text through a deliberately minimal
[test-only reader](packages/script/src/testing/fdx-reader.ts) that must never grow into a general
XML parser.

Unwritten and unblocked: pagination, FDX export.

Do not create `apps/sync/`.

## Commands

```bash
pnpm typecheck            # 6 packages
pnpm lint                 # includes //#lint:root for eslint.config.mjs itself
pnpm test                 # only @folio/script and web have test scripts
pnpm build                # only web has a build script
pnpm test:e2e             # needs `pnpm --filter web exec playwright install chromium` first

pnpm --filter @folio/script test --coverage                        # note: no `--`
pnpm --filter @folio/script exec vitest run src/derive.test.ts      # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test
```

Traps, each of which produces a false reading:

1. **Turbo replays cached logs indistinguishably from a run.** `>>> FULL TURBO` means nothing
   executed — the test counts you are reading are a recording. Force it before reporting a suite as
   passing: `pnpm exec turbo run test --force`.
2. **`pnpm --filter web test` fails on a fresh run** — `ERR_REQUIRE_ESM` from jsdom. Local Node is
   v22.5.1, below the `>=22.12.0` in `engines`; `.npmrc` sets `engine-strict=false` so install only
   warns. Node ≥22.12 fixes it. CI reads [.nvmrc](.nvmrc) and does not hit it. It also fails the
   whole `turbo run` early, so a root `pnpm test` can abort before `@folio/script` is reached — run
   that package directly to see it.
3. **AGENTS.md's own coverage command does nothing.** `test -- --coverage` passes both args to
   vitest as filename filters: suite runs, no table, exit 0. Drop the `--`.
4. **On Windows, vitest prints an `EPERM` "failed to terminate forks worker" stack** after a passing
   run. Read the summary counts, not the stack.

## packages/script — the pure core

The only package with real code. **Every file opens with a header comment naming the AGENTS.md rule
it implements and why the shape is what it is. Those headers are the design record — the phase 2–4
rulings were written down there, not in [docs/build-decisions.md](docs/build-decisions.md), which is
still a stub.** Read them before changing anything. The cross-file invariants none of them states
alone:

- **Nothing throws.** Every fallible function returns `Result<T, E>`; a malformed heading is data.
- **Nothing mints an id**, and this now reaches everything: operations take `tailId` / `freshIds`,
  and `parseFountain`, `importFinalDraft` and `derive` each consume a caller-supplied `freshIds` in
  document order, with `countFountainNodes` / `countFdxNodes` / `countDerivationIds` answering "how
  many" before any is spent. A short list is `not-enough-ids` data, never a throw. This is what makes
  a speculative derive byte-identical to the real one.
- **Operations return `{ nodes, identity, dropped }`, never a bare node list.** `packages/script`
  cannot reach the comment and proposal rows anchored to node ids, so it reports what happened to the
  ids and a repository in `packages/db` replays them. Flatten that shape and reviewer comments
  silently re-point at someone else's line.
- **One discriminator for generated text.** [generated-text.ts](packages/script/src/generated-text.ts)
  is the only place authored `(V.O.)` is told from generated `(CONT'D)`, and both Fountain and FDX
  call it. A second implementation is precisely how AGENTS.md's doubling bug gets in — which is why
  it recognises six apostrophe code points and every `(CONT'D)` spelling seen in the wild.
- **One derivation, no fast path.** `derive` has no incremental or speculative variant on purpose:
  blast radius is only meaningful if the prediction comes from the code that will actually run.
- **Reconcile, never rebuild — enforced by reference.** Each derived record keeps its authored data
  in one `authored` sub-object that `derive` carries across untouched, so "survives a re-derive
  intact" is asserted as `next.authored === previous.authored`, not a field-by-field audit. A record
  whose name has left the script returns with `presence: 'absent'`, never deleted.
- **Nothing binds by resemblance.** Only an exact alias-table key match against an authored bound cue
  resolves a cue to a record; every near-miss is a resolve-queue row carrying a confidence, for the
  writer to accept or reject. Same for the location tree — derivation mints location records but
  never writes `parent`, it proposes the edge. Do not add diacritic folding to `canonicalKey`:
  Devanagari vowel signs are combining marks, so it would mangle every Hindi cue to tidy up a Latin
  one.
- **The page ban is enforced twice from one `PAGINATION_FIELDS` tuple**: `page?: never` at compile
  time, rejection at the wire in `read.ts`. Reading is strict, so adding a field to a node is a
  breaking wire change — which needs an ADR anyway.
- **Screenplay and outline are separate closed unions sharing no member.** `*_TYPE_COVERAGE` records
  stop compiling if a union and its runtime tag set drift.

## Enforcement is in the config, not in review

[eslint.config.mjs](eslint.config.mjs) makes AGENTS.md executable — the purity boundary around
`packages/script` plus the repo-wide "Deliberately not using" ban list, as errors carrying their own
rationale. Two gotchas: exemptions are pre-declared for directories that do not exist yet
(`packages/ui/src/tokens`, `apps/web/lib/auth|storage`), and flat config is last-match-wins, so
block order is load-bearing. The test override relaxes globals, not imports — test support still
cannot reach `node:fs`.

[tsconfig.base.json](tsconfig.base.json) sets `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` — the `if (node === undefined)` guard after an index lookup is
required, not redundant.

**`pnpm typecheck` is also a test suite.**
[type-guarantees.test.ts](packages/script/src/type-guarantees.test.ts) asserts with
`@ts-expect-error`. A typecheck failure there is the guarantee working; fix the model, not the
directive.

## The design bundles

`docs/ui design/` — one `.dc.html` per route, `screenshots/`, and a
[README.md](docs/ui%20design/README.md). Untouched since the first commit.

- **Read the `.dc.html` files as source text** for exact hex, px and copy; they do not render
  (`support.js` is a mock runtime expecting a `window.React` that never loads). Use `screenshots/`
  for the visual read. **Never port `support.js` or the `<x-dc>` markup.**
- [Route - Script.dc.html](docs/ui%20design/Route%20-%20Script.dc.html) wins on chrome. The two
  `Screenwriting App*.dc.html` shells are an older generation — stale palette and route ids.
- The README self-reconciles, in its own "bundles show / build instead" table: terracotta accent,
  no icon library, `film | series`, credits in the Production header. Build the right-hand column.
  **Two rows stay open** — which pass you are in (frontend-only fixtures vs AGENTS.md's schema-first
  workflow), and 12 vs 6 lines per inch. Ask; they are not resolvable by inference.
- `original-spec/`, referenced by the README's file map, is not in this repo.
- Density is deliberate: 11–13px chrome type is correct. Copy is final — do not paraphrase.

## Working here

- **Escalate the nine open decisions; do not resolve them.** Several block whole routes.
- **[ADR 0001](docs/adr/0001-node-identity.md) now records two rulings, both delegated to the
  implementer rather than reasoned out with product context, and both marked reversible** — identity
  under split/merge/paste, and the id shape. Read its preamble. The second ruling's item 5 (`ep_NNN`
  treated as a slug, with the episode's real key a separate opaque id) is flagged as the one needing
  a human; it rests on a product claim about whether episodes are ever reordered.
- **Any dependency needs approval, every time.** `packages/script` takes zero runtime dependencies
  and its `dependencies` block is still empty — keep it that way.
- A route is not done without both states and both themes.
- Report literally: paste failing output, name assumptions where you made them, and flag any rule
  you were tempted to break.
