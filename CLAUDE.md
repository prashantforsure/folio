# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read AGENTS.md first

[AGENTS.md](AGENTS.md) is the contract — stack, domain rules, exception tables, conventions, the
nine open decisions. Read it before your first change. This file adds only what it cannot know: the
state of the code, and the traps in it.

Why the code reads the way it does: **the script is a typed node list and the only hand-authored
artefact.** Scenes, characters, locations, page counts and shot lists are derived views. Nearly
every real bug here is some other surface quietly becoming authoritative.

Everything else loads on demand. Do not read these speculatively — they are large:

| Before you… | Read |
| --- | --- |
| build a route or touch UI | [docs/ui design/CLAUDE.md](docs/ui%20design/CLAUDE.md), then that one route's bundle |
| change node identity or the id shape | [ADR 0001](docs/adr/0001-node-identity.md) — preamble first; both its rulings were delegated to the implementer and are marked reversible |
| touch `episodes`, or anything joining on one | [ADR 0002](docs/adr/0002-episode-identity.md) — `ep_NNN` is a slug over an opaque key. Delegated too, and it names the one product claim that would overturn it |
| add a table, or ask what may write one | [packages/db/src/schema/index.ts](packages/db/src/schema/index.ts) — every table classified authored / derived-cache / measurement |
| answer something the spec leaves open | [docs/build-decisions.md](docs/build-decisions.md) — its "Open, and blocking" section is the live escalation list |
| edit a file in `packages/script` | that file's own header comment |

## Repository state

[packages/script](packages/script/src/index.ts) is the pure core — node model and seven operations,
Fountain both ways, FDX import, derivation, pagination. 19 test files, 388 tests, passing.

[packages/contracts](packages/contracts/src/index.ts) and [packages/db](packages/db/src/index.ts)
are now built: Zod boundary schemas, a 30-table Drizzle schema with two forward-only migrations,
and project-scoped repositories. `@folio/ui` and `apps/worker` still export one `PACKAGE_NAME` and
nothing else — empty on purpose, each header says why.
[apps/web](apps/web/app/page.tsx) is a placeholder page so `next build` has a route. No design
token and no real route yet.

**Nothing in the repo needs a live database** to typecheck, lint, build or test. The two connection
factories in [client.ts](packages/db/src/client.ts) are lazy, so importing `@folio/db` for a table
definition reads no environment and opens no socket. `drizzle-kit generate` and `drizzle-kit check`
need the variables to be *present* but never connect; only `drizzle-kit migrate` does.

**The environment is read in exactly one file** — [env.ts](packages/db/src/env.ts), behind
`@folio/db/env` so a secret cannot ride into a bundle via a table import. `process.env` anywhere
else is a lint error, with test-runner configs the only other exemption.

**Tenancy is a compile error, not a review catch.** [scope.ts](packages/db/src/scope.ts) — a
`ProjectScope` is keyed by a private `unique symbol`, so it cannot be fabricated; every repository
takes one; the handle is behind a second symbol; and a table without `project_id` is not assignable.
[scope-guarantees.ts](packages/db/src/scope-guarantees.ts) proves all four with `@ts-expect-error`,
so `pnpm typecheck` is the test that they hold.

**The migrations have never been applied.** They are generated and `drizzle-kit check` is clean, but
no Postgres has parsed them — see the report and `docs/build-decisions.md`.

**FDX import cannot be called yet.** `importFinalDraft` takes an **already-parsed XML tree** so the
mapping stays pure and the caller owns the parse; [fdx.ts](packages/script/src/fdx.ts) names the
`fast-xml-parser` options it expects, and that dependency is unapproved and in no `package.json`.
Tests read real `.fdx` through a deliberately minimal
[test-only reader](packages/script/src/testing/fdx-reader.ts) that must never become a general XML
parser.

Unwritten and unblocked: **FDX export**. Do not create `apps/sync/`.

## Commands

```bash
pnpm typecheck            # 6 packages
pnpm lint                 # includes //#lint:root for eslint.config.mjs itself
pnpm test                 # only @folio/script and web have test scripts
pnpm build                # only web has a build script
pnpm test:e2e             # needs `pnpm --filter web exec playwright install chromium` first

pnpm --filter @folio/script test --coverage                        # note: no `--`
pnpm --filter @folio/script exec vitest run src/paginate.test.ts    # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test
```

Four traps, each of which produces a false reading:

1. **Turbo replays cached logs indistinguishably from a run.** `>>> FULL TURBO` means nothing
   executed — the counts you are reading are a recording. Force it before reporting a suite as
   passing: `pnpm exec turbo run test --force`.
2. **`pnpm --filter web test` fails on a fresh run** — `ERR_REQUIRE_ESM` from jsdom. Local Node is
   v22.5.1, below the `>=22.12.0` in `engines`; `.npmrc` sets `engine-strict=false` so install only
   warns, and CI reads [.nvmrc](.nvmrc) and never hits it. It fails the `turbo run` early, so a root
   `pnpm test` can abort before `@folio/script` is reached — run that package directly.
3. **AGENTS.md's own coverage command does nothing.** `test -- --coverage` passes both args to
   vitest as filename filters: suite runs, no table, exit 0. Drop the `--`.
4. **On Windows, vitest prints an `EPERM` "failed to terminate forks worker" stack** after a passing
   run. Read the summary counts, not the stack.

## packages/script — the pure core

**Every file opens with a header comment naming the AGENTS.md rule it implements and why the shape
is what it is. Those headers are the design record — read the one you are editing, not all of
them.** The cross-file invariants none of them states alone:

- **Nothing throws.** Every fallible function returns `Result<T, E>`; a malformed heading is data.
- **Nothing mints an id.** Operations take `tailId` / `freshIds`; `parseFountain`,
  `importFinalDraft` and `derive` each consume caller-supplied `freshIds` in document order, with
  `countFountainNodes` / `countFdxNodes` / `countDerivationIds` answering "how many" first. A short
  list is `not-enough-ids` data, never a throw. This is what makes a speculative derive
  byte-identical to the real one.
- **Operations return `{ nodes, identity, dropped }`, never a bare node list.** This package cannot
  reach the comment and proposal rows anchored to node ids, so it reports what happened to the ids
  and a repository in `packages/db` replays them. Flatten that shape and reviewer comments silently
  re-point at someone else's line.
- **One discriminator for generated text.** [generated-text.ts](packages/script/src/generated-text.ts)
  is the only place authored `(V.O.)` is told from generated `(CONT'D)`; Fountain, FDX and the
  paginator all call it. A second implementation is precisely how AGENTS.md's doubling bug gets in.
- **One derivation, no fast path.** `derive` has no incremental or speculative variant on purpose:
  blast radius is only meaningful if the prediction comes from the code that will actually run.
- **Reconcile, never rebuild — enforced by reference.** Each derived record keeps its authored data
  in one `authored` sub-object carried across untouched, so "survives a re-derive" is asserted as
  `next.authored === previous.authored`, not a field-by-field audit. A name gone from the script
  returns `presence: 'absent'`, never deleted.
- **Nothing binds by resemblance.** Only an exact alias-table key match resolves a cue to a record;
  every near-miss is a resolve-queue row carrying a confidence. Same for the location tree —
  derivation mints location records but proposes `parent`, never writes it. Do not add diacritic
  folding to `canonicalKey`: Devanagari vowel signs are combining marks, so it would mangle every
  Hindi cue to tidy up a Latin one.
- **The page ban is enforced twice from one `PAGINATION_FIELDS` tuple**: `page?: never` at compile
  time, rejection at the wire in `read.ts`. Reading is strict, so adding a field to a node is a
  breaking wire change — which needs an ADR anyway.
- **Screenplay and outline are separate closed unions sharing no member.** `*_TYPE_COVERAGE` records
  stop compiling if a union and its runtime tag set drift.

### Pagination

[paginate.ts](packages/script/src/paginate.ts) is one pure function from a node list and a format to
a **measurement record**. Its output type contains ids, never nodes, so no expression in the module
could write a page onto a node. Around it: [sheet.ts](packages/script/src/sheet.ts) resolves a
format to geometry once, at the door, so nothing downstream consults a flag;
[measure.ts](packages/script/src/measure.ts) counts monospace lines — arithmetic, no font table;
[revision.ts](packages/script/src/revision.ts) holds locked pages and the colours.

- **`resolveSheet('asian')` refuses.** AGENTS.md open decision 8 (A4 sheet width) is unruled, so it
  returns both candidate widths as evidence and neither as a choice. Do not give it a default.
  Everything else about the format is wired.
- **`LINES_PER_INCH = 12` is one constant, and disputed** — AGENTS.md says 12, the design bundle
  draws 6. Nothing else hard-codes a line count, so re-ruling it is a one-line change plus a golden
  regeneration. It moves a feature's page count by roughly a factor of two; it needs a human.
- **Golden page maps are a contract, not a snapshot — there is no `-u`.** Run
  [golden-page-map.test.ts](packages/script/src/golden-page-map.test.ts); on a mismatch it prints the
  complete replacement JSON to stdout and fails. Paste it into
  [testing/golden/](packages/script/src/testing/golden/) and commit it as its own change.
- **Revision colours live here, not in `packages/ui`.** The moment they are tokens they can be
  themed, and a themed salmon page is a wrong page. `nextRevisionColour('green')` refuses.

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
`@ts-expect-error`, including the compile-time proof that pagination cannot return a node. A
typecheck failure there is the guarantee working; fix the model, not the directive.

## Working here

- **Escalate the open decisions; do not resolve them.** Several block whole routes. Currently open
  and blocking: the A4 sheet width, 12 vs 6 lines per inch, page numbering past the last lock, and
  the revision sequence past green.
- **Any dependency needs approval, every time.** `packages/script`'s `dependencies` block is empty —
  keep it that way.
- Report literally: paste failing output, name assumptions where you made them, and flag any rule
  you were tempted to break.
