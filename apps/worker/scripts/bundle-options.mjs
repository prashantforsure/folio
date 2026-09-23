// The esbuild options every worker bundle shares - `build.mjs` (the worker)
// and `run.mjs` (a one-off script) - so the two cannot drift apart.
//
// `next/*` resolves to `src/next-stub.ts`: nothing the worker runs may call a
// Next request API, and if a path to one ever opens the call fails with its
// name (web's `tests/worker-import-graph.test.ts` is the check that none does).
//
// The banner gives the CommonJS modules inside the bundle a `require` for the
// Node built-ins they ask for, which an ESM file does not have.
import { resolve } from 'node:path'

/** @param {string} root the worker's directory */
export const bundleOptions = (root) => {
  const stub = resolve(root, 'src/next-stub.ts')
  return {
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    legalComments: 'none',
    alias: {
      'next/cache': stub,
      'next/headers': stub,
      'next/navigation': stub,
      'next/server': stub,
    },
    banner: {
      js: "import { createRequire as __folioCreateRequire } from 'node:module'; const require = __folioCreateRequire(import.meta.url);",
    },
  }
}
