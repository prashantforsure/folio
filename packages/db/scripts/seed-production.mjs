// The dev-only Production seed's launcher. The seed is TypeScript with the
// package's extensionless imports, so it runs through `tsx` - which is not a
// dependency of this package but is one of `drizzle-kit`'s (it loads
// `drizzle.config.ts` through it), so it is resolved from there rather than
// added. `pnpm --filter @folio/db seed:production -- --user <email>`.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// drizzle-kit's package.json is not exported; its bin is, and tsx sits beside it in the store.
const drizzleKit = createRequire(import.meta.url).resolve('drizzle-kit')
const tsxPackage = createRequire(drizzleKit).resolve('tsx/package.json')
const tsx = resolve(dirname(tsxPackage), 'dist/cli.mjs')
const seed = resolve(here, '../src/seed/production.ts')
const result = spawnSync(process.execPath, [tsx, seed, ...process.argv.slice(2)], { stdio: 'inherit', cwd: resolve(here, '..') })
process.exit(result.status ?? 1)
