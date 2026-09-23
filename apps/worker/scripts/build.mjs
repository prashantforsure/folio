// The worker's build: one ESM file, `dist/main.mjs`, that plain `node` runs.
//
// Why a bundle (ruled 2026-09-23, roadmap Phase 4): every workspace package
// exports its TypeScript source (`@folio/db`'s `exports` point at `.ts`), and
// the handlers are web's (`web/worker`), so there is nothing `node` could load
// as it stands. esbuild - approved as this app's one devDependency for exactly
// this - follows the imports, strips the types and writes one file, so the
// container needs no `node_modules` and no TypeScript at run time.
//
// `next/*` resolves to `src/next-stub.ts`: nothing the worker runs may call a
// Next request API, and if a path to one ever opens the call fails with its
// name (web's `tests/worker-import-graph.test.ts` is the check that none does).
//
// The banner gives the CommonJS modules inside the bundle a `require` for the
// Node built-ins they ask for, which an ESM file does not have.
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stub = resolve(root, 'src/next-stub.ts')

await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  alias: {
    'next/cache': stub,
    'next/headers': stub,
    'next/navigation': stub,
    'next/server': stub,
  },
  banner: {
    js: "import { createRequire as __folioCreateRequire } from 'node:module'; const require = __folioCreateRequire(import.meta.url);",
  },
})
