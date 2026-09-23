// Run one of the worker's one-off TypeScript scripts (`scripts/*.ts`).
//
//   node --env-file=apps/web/.env apps/worker/scripts/run.mjs scripts/cancel-stale-jobs.ts --before 2026-09-20
//   pnpm --filter worker cancel-stale-jobs -- --before 2026-09-20      (reads apps/worker/.env, if any)
//
// Bundled exactly as the worker is (`bundle-options.mjs`) into
// `dist/scripts/<name>.mjs`, then run with this Node and this environment:
// the workspace packages export TypeScript source, so there is nothing plain
// `node` could load as it stands, and esbuild is already the worker's one
// devDependency for that reason. `env.ts` loads `.env` from the working
// directory when there is one.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundleOptions } from './bundle-options.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [entry, ...rest] = process.argv.slice(2)
if (entry === undefined || !entry.endsWith('.ts')) {
  console.error('Usage: node scripts/run.mjs scripts/<name>.ts [arguments]')
  process.exit(2)
}
// `pnpm run x -- --flag` hands the separator through.
const args = rest[0] === '--' ? rest.slice(1) : rest
const outfile = resolve(root, 'dist/scripts', `${basename(entry, '.ts')}.mjs`)

await build({
  ...bundleOptions(root),
  entryPoints: [resolve(root, entry)],
  outfile,
  logLevel: 'warning',
})

const result = spawnSync(process.execPath, ['--enable-source-maps', outfile, ...args], { stdio: 'inherit' })
process.exit(result.status ?? 1)
