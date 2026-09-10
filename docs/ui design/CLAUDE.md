# CLAUDE.md — the design bundles

Read this before building a route or any UI. **None of it is needed for work inside
`packages/script`**, which is where all the code currently is.

One `.dc.html` per route, plus `screenshots/` and a [README.md](README.md). The README is 768 lines
and the bundles total ~740KB — open the one route you are building, not the set.

- **Read the `.dc.html` files as source text** for exact hex, px and copy. They do not render:
  `support.js` is a mock runtime expecting a `window.React` that never loads. Use `screenshots/`
  for the visual read. **Never port `support.js` or the `<x-dc>` markup.**
- [Route - Script.dc.html](Route%20-%20Script.dc.html) wins on chrome wherever two bundles disagree.
  The two `Screenwriting App*.dc.html` shells are an older generation — stale palette and route ids.
- The README self-reconciles, in its own "bundles show / build instead" table: terracotta accent, no
  icon library, `film | series`, credits in the Production header. **Build the right-hand column.**
- **Two rows stay open and are not resolvable by inference — ask.** Which pass you are in
  (frontend-only fixtures vs AGENTS.md's schema-first workflow), and 12 vs 6 lines per inch. The
  second also moves the page count by roughly a factor of two; the engine implements 12 as AGENTS.md
  writes it, in one constant.
- Density is deliberate: 11–13px chrome type is correct. Copy is final — do not paraphrase.
- `original-spec/`, referenced by the README's file map, is not in this repo.
- A route is not done without both states (populated and empty) and both themes.
