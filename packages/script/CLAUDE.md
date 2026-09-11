# packages/script — the pure core

Loads when you work in this directory. Root `CLAUDE.md` still applies.

**Every file opens with a header comment naming the AGENTS.md rule it implements and why the shape
is what it is. Read the header of the file you are editing, not all of them.** The cross-file
invariants no header states alone:

- **Nothing throws.** Every fallible function returns `Result<T, E>`; a malformed heading is data.
- **Nothing mints an id.** Operations take `tailId` / `freshIds`; `parseFountain`,
  `importFinalDraft` and `derive` consume caller-supplied `freshIds` in document order, with
  `countFountainNodes` / `countFdxNodes` / `countDerivationIds` answering "how many" first. A short
  list is `not-enough-ids` data, never a throw. This is what makes a speculative derive
  byte-identical to the real one.
- **Operations return `{ nodes, identity, dropped }`, never a bare node list.** Comment and proposal
  rows anchored to node ids live in `packages/db`, which replays `identity`. Flatten the shape and
  reviewer comments silently re-point at someone else's line.
- **One discriminator for generated text.** [generated-text.ts](src/generated-text.ts) is the only
  place authored `(V.O.)` is told from generated `(CONT'D)`; Fountain, FDX and the paginator all
  call it. A second implementation is exactly how AGENTS.md's doubling bug gets in.
- **One derivation, no fast path.** `derive` has no incremental or speculative variant on purpose:
  blast radius only means something if the prediction comes from the code that will run.
- **Reconcile, never rebuild — enforced by reference.** Each derived record carries its authored
  data in one `authored` sub-object, so "survives a re-derive" is asserted as
  `next.authored === previous.authored`. A name gone from the script is `presence: 'absent'`, never
  deleted.
- **Nothing binds by resemblance.** Only an exact alias-table key resolves a cue to a record; every
  near-miss is a resolve-queue row with a confidence. Derivation mints location records but
  proposes `parent`, never writes it. Do not add diacritic folding to `canonicalKey` — Devanagari
  vowel signs are combining marks; it would mangle every Hindi cue to tidy a Latin one.
- **The page ban is enforced twice from one `PAGINATION_FIELDS` tuple**: `page?: never` at compile
  time, rejection at the wire in `read.ts`. Reading is strict, so adding a node field is a breaking
  wire change — which needs an ADR anyway.
- **Screenplay and outline are separate closed unions sharing no member.** `*_TYPE_COVERAGE`
  records stop compiling if a union and its runtime tag set drift.
- **`dependencies` is empty and stays empty.** `importFinalDraft` takes an already-parsed XML tree
  for that reason; [fdx.ts](src/fdx.ts) names the `fast-xml-parser` options it expects, and that
  package is unapproved and in no `package.json` — so FDX import cannot be called yet. Tests read
  `.fdx` through [testing/fdx-reader.ts](src/testing/fdx-reader.ts), which must never become a
  general XML parser.

## Pagination

[paginate.ts](src/paginate.ts) is one pure function from a node list and a format to a
**measurement record** — ids, never nodes, so no expression in the module could write a page onto
a node. [sheet.ts](src/sheet.ts) resolves a format to geometry once, at the door;
[measure.ts](src/measure.ts) counts monospace lines, arithmetic only; [revision.ts](src/revision.ts)
holds locked pages and the colours.

- **`resolveSheet('asian')` refuses** — open decision 8 (A4 width) is unruled; it returns both
  candidate widths as evidence. Do not give it a default.
- **`LINES_PER_INCH = 12` is one constant, and disputed** — AGENTS.md says 12, the design bundle
  draws 6. Re-ruling is a one-line change plus a golden regeneration, and moves page counts by
  roughly 2×. It needs a human.
- **Golden page maps are a contract; there is no `-u`.** On a mismatch
  [golden-page-map.test.ts](src/golden-page-map.test.ts) prints the full replacement JSON and
  fails. Paste it into [testing/golden/](src/testing/golden/) and commit it as its own change.
- **Revision colours live here, not in `packages/ui`** — tokens can be themed, and a themed salmon
  page is a wrong page. `nextRevisionColour('green')` refuses.

## Tests

```bash
pnpm --filter @folio/script test --coverage                        # no `--` (see root trap 3)
pnpm --filter @folio/script exec vitest run src/paginate.test.ts    # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test
```

[type-guarantees.test.ts](src/type-guarantees.test.ts) asserts with `@ts-expect-error` — including
that pagination cannot return a node — so `pnpm typecheck` is part of the suite. A failure there is
the guarantee working: fix the model, not the directive. The eslint test override relaxes globals,
not imports; test support still cannot reach `node:fs`.
