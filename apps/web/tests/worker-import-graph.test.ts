// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What the worker may reach - roadmap task 4.2.
 *
 * The worker runs web's code outside any Next request (`apps/worker` bundles
 * `lib/worker/index.ts`), and the agent's tools run there too from task 4.4. A
 * module on that path that imports a Next request API - `cookies()`,
 * `revalidatePath()`, `after()`, `redirect()` - or the cookie-reading session,
 * or is a `'use server'` module (every export of which is a public endpoint),
 * is a bug waiting for the first job that reaches it. So this walks the
 * **value** imports (a type import is erased and reaches nothing) from each
 * root the worker loads, across `apps/web/lib`, and names every module that
 * breaks the rule and the path that got there.
 *
 * Workspace packages (`@folio/*`) are not walked: `packages/script` is pure by
 * lint, and `@folio/db` imports nothing of web's.
 */

const WEB = resolve(import.meta.dirname, '..')

const ROOTS = ['lib/worker/index.ts', 'lib/agent/tools/index.ts', 'lib/agent/apply.ts', 'lib/agent/proposer.ts', 'lib/agent/loop.ts']

const BANNED_SPECIFIERS = [/^next(\/|$)/, /^@supabase\//, /^react-dom(\/|$)/]

const BANNED_MODULES = ['lib/auth/session.ts', 'lib/auth/server.ts', 'lib/workspace/context.ts']

/** Every value import of a file: `import x from`, `import { x } from`, `import 'x'`, `export { x } from`, `import('x')`. */
const importsOf = (source: string): readonly string[] => {
  const found: string[] = []
  const statement = /(?:^|\n)\s*(import|export)(\s+type)?\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  for (const match of source.matchAll(statement)) {
    const isType = match[2] !== undefined
    const specifier = match[3]
    if (!isType && specifier !== undefined) found.push(specifier)
  }
  for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (match[1] !== undefined) found.push(match[1])
  }
  return found
}

const resolveLocal = (from: string, specifier: string): string | null => {
  const base = resolve(dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('.css') && (candidate.endsWith('.ts') || candidate.endsWith('.tsx'))) return candidate
  }
  return null
}

type Problem = { readonly module: string; readonly why: string; readonly path: readonly string[] }

const walk = (root: string): { readonly problems: readonly Problem[]; readonly reached: readonly string[] } => {
  const problems: Problem[] = []
  const seen = new Map<string, readonly string[]>()
  const queue: { readonly file: string; readonly path: readonly string[] }[] = [{ file: resolve(WEB, root), path: [root] }]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined) break
    const { file, path } = next
    if (seen.has(file)) continue
    seen.set(file, path)
    const name = relative(WEB, file).split('\\').join('/')
    const source = readFileSync(file, 'utf8')
    if (/^\s*['"]use server['"]/.test(source)) problems.push({ module: name, why: "a 'use server' module", path })
    if (BANNED_MODULES.includes(name)) problems.push({ module: name, why: 'reads the cookie session', path })
    for (const specifier of importsOf(source)) {
      if (BANNED_SPECIFIERS.some((pattern) => pattern.test(specifier))) {
        problems.push({ module: name, why: `imports ${specifier}`, path })
        continue
      }
      if (!specifier.startsWith('.')) continue
      const target = resolveLocal(file, specifier)
      if (target !== null) queue.push({ file: target, path: [...path, relative(WEB, target).split('\\').join('/')] })
    }
  }
  return { problems, reached: [...seen.keys()].map((file) => relative(WEB, file).split('\\').join('/')) }
}

describe('the worker import graph', () => {
  it.each(ROOTS)('%s reaches no Next request API, no cookie session and no server action', (root) => {
    const problems = walk(root).problems.map((problem) => `${problem.module}: ${problem.why}\n    via ${problem.path.join(' -> ')}`)
    expect(problems).toEqual([])
  })

  it('walks the whole graph - the registry reaches every route`s core functions', () => {
    const { reached } = walk('lib/agent/tools/index.ts')
    for (const core of ['lib/characters/core.ts', 'lib/locations/core.ts', 'lib/script/core.ts', 'lib/production/generate-core.ts', 'lib/script/server.ts', 'lib/script/actor-gate.ts']) expect(reached).toContain(core)
    expect(reached.length).toBeGreaterThan(40)
  })

  it('reads a type import as reaching nothing, and a value import as reaching its module', () => {
    expect(importsOf("import type { A } from 'next/server'\nimport { b } from './b'\nexport { c } from './c'\nimport './d'")).toEqual(['./b', './c', './d'])
    expect(importsOf("import {\n  x,\n  y,\n} from 'next/cache'")).toEqual(['next/cache'])
  })
})
