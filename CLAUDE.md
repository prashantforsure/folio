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

## Repository state

**Nothing is scaffolded yet.** The repo currently contains only `AGENTS.md` and `docs/ui design/`.
There is no `package.json`, no workspace, no source, and it is not a git repository.

Consequences:

- The validation commands in AGENTS.md (`pnpm typecheck` / `lint` / `test` / `build`) describe the
  contract the scaffold must satisfy. They do not run yet. Say so rather than skipping validation
  silently or reporting an invented pass.
- The directory tree in AGENTS.md's Architecture section is the target layout, not a description of
  what exists. Create directories as thin vertical slices need them — and not `apps/sync/`, which is
  explicitly deferred.

## The design bundles

`docs/ui design/` holds the design reference: one `.dc.html` per route, plus `screenshots/*.png`,
plus [README.md](docs/ui%20design/README.md) describing shell layout, tokens, type scale, geometry
and interactions.

- **Read the `.dc.html` files as source text** for exact hex values, pixel values and copy. They do
  not reliably render in a browser — `support.js` is a generated mock runtime (`<x-dc>`, `{{ holes }}`,
  `<sc-for>`, `<sc-if>`) that expects `window.React`, which the route files never load. Use
  `screenshots/` for the visual read.
- **Never port `support.js` or the `<x-dc>` markup.** They are prototype scaffolding.
- Precedence, per AGENTS.md: where two bundles disagree on chrome,
  [Route - Script.dc.html](docs/ui%20design/Route%20-%20Script.dc.html) wins.
- Density is deliberate. 11–13px chrome type is correct; do not raise it to a 14/16px web default.
  Copy is final; do not paraphrase labels or empty states.

## Known contradictions between the docs

These are real, and a future instance will otherwise resolve one by accident. AGENTS.md is the newer
document and wins on every one of them, but flag rather than silently pick.

| Conflict | Resolution |
| --- | --- |
| **Accent colour.** The README token table and both shell bundles use violet `oklch(0.52 0.13 285)`. All fourteen `Route - *.dc.html` bundles use terracotta `oklch(0.50 0.17 27)` (dark: `oklch(0.72 0.14 30)`), and AGENTS.md says terracotta. | **Terracotta.** Take the accent set from a route bundle, not from the README table or the shell files — the README's is stale. |
| **Product name.** The design README calls the app *Laper*; AGENTS.md calls it *Folio*, as does the workspace package prefix `@folio/*`. | **Folio.** |
| **Project kinds.** README Appendix A has `kind: 'series' \| 'feature' \| 'short'`; AGENTS.md's Constraints say film and series only, no `short`. | **`film` and `series`.** Fixture types otherwise follow Appendix A. |
| **Icons.** README says "Lucide is fine"; AGENTS.md's do-not-add list forbids any icon library — every glyph is a Unicode character rendered as text. | **Unicode glyphs.** |
| **Scope.** README scopes its pass to frontend-only against local TypeScript fixtures; AGENTS.md's feature workflow starts at schema and migration. | Ask which pass you are in before building a route. They are not reconcilable by inference. |

`docs/ui design/original-spec/`, referenced by the README's file map, **does not exist in this
repo.** Nothing can be checked against the original route spec — treat the design bundles and
AGENTS.md as the only available sources.

## Working here

- AGENTS.md's *When to ask first* list and *Open decisions* table are load-bearing. Nine product
  decisions are deliberately unresolved; several block whole routes. Escalate, do not choose.
- Adding any dependency requires approval, every time. `packages/script` takes zero new runtime
  dependencies.
- A route is not done without both states (populated and empty) and both themes.
