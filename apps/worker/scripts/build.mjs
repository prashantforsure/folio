// The worker's build: one ESM file, `dist/main.mjs`, that plain `node` runs.
//
// Why a bundle (ruled 2026-09-23, roadmap Phase 4): every workspace package
// exports its TypeScript source (`@folio/db`'s `exports` point at `.ts`), and
// the handlers are web's (`web/worker`), so there is nothing `node` could load
// as it stands. esbuild - approved as this app's one devDependency for exactly
// this - follows the imports, strips the types and writes one file, so the
// container needs no `node_modules` and no TypeScript at run time.
//
// The options are `bundle-options.mjs`'s, shared with `run.mjs`.
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundleOptions } from './bundle-options.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  ...bundleOptions(root),
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  logLevel: 'info',
})
