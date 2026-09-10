/**
 * @folio/script — the pure core.
 *
 * Deliberately empty. Phase 2 starts here, from nothing: node model, parser,
 * derivation, pagination, Fountain. Zero runtime dependencies, now and always.
 *
 * Constraints this package is under (AGENTS.md):
 *   - No React, no database, no fetch, no process.env, no Date.now(),
 *     no Math.random(). Enforced by eslint.config.mjs, not by convention.
 *   - It must run identically in the browser, in server code, in the worker
 *     and in tests.
 */
export const PACKAGE_NAME = '@folio/script'
