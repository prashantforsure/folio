#!/usr/bin/env node
/**
 * Fail the build if a server secret reached anything the browser downloads.
 *
 * AGENTS.md, Tenancy and data access: "**The service-role key must never reach
 * the browser.** Same for Dodo keys." That key bypasses Row Level Security
 * entirely, so a copy of it in a JavaScript bundle is read and write access to
 * every project in the database, for anybody who opens devtools.
 *
 * Everything else guarding it is a convention that holds until someone is in a
 * hurry: `@folio/db/env` throws in a browser, eslint bans bare `process.env`,
 * and the export map keeps secrets off the package index. Each of those can be
 * routed around by an honest mistake - a `'use client'` added to the top of a
 * file that already imported something, a value pasted inline "just to test".
 * This script cannot be routed around, because it reads the build output rather
 * than the source. It is the last thing that runs and it is the only check here
 * that inspects what is actually shipped.
 *
 * ## What it reads
 *
 *   .next/static/**            every JS and CSS chunk the browser fetches
 *   .next/server/**\/*.html    prerendered HTML, which is sent verbatim
 *   .next/server/**\/*.rsc     Flight payloads, which are also sent verbatim
 *
 * Deliberately **not** `.next/server/**\/*.js`. Server bundles are supposed to
 * contain secrets; flagging them would train everybody to ignore this script,
 * which is the only way a check like this actually fails.
 *
 * ## What it looks for
 *
 * 1. **The value**, when the variable is set in this environment. The strongest
 *    signal and the only one that catches a hardcoded literal. Skipped when the
 *    variable is absent, which is why 2 exists.
 * 2. **The variable's name.** Next does not inline a variable without the
 *    `NEXT_PUBLIC_` prefix, so `process.env.SUPABASE_SERVICE_ROLE_KEY` written
 *    in a Client Component survives into the bundle as a property access on an
 *    empty object - evaluating to `undefined`, which is not a leak, but is a
 *    file that believes it has the key and a rename away from being one.
 * 3. **The env module's own error text.** If `@folio/db/env` is ever bundled
 *    for the browser, its `refuseBrowser()` message goes with it. String
 *    literals survive minification, so this catches the import even when the
 *    key itself is absent from the build machine.
 *
 * ## Reporting
 *
 * The finding names the file, the offset and the needle **by label**. It never
 * prints the matched text: a CI log is not a secret store, and a check that
 * echoes the key it found has published it a second time. If this fires, rotate
 * the key in the Supabase dashboard before fixing the code. Rotating is cheap.
 *
 * ## Why this file may read process.env
 *
 * `eslint.config.mjs` bans the expression everywhere but `packages/db/src/env.ts`.
 * This script is exempted alongside the test-runner configs, on the same
 * grounds: it is build tooling, it runs in Node outside anything Folio serves,
 * and its whole purpose is to compare the raw environment against the raw build
 * output. Routing it through the typed object would mean importing a module
 * that throws when the variable is absent - and "absent" is a perfectly normal
 * state for a machine that is only building.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const WEB_ROOT = resolve(import.meta.dirname, '..')
const BUILD_DIR = join(WEB_ROOT, '.next')

/** Server-only variables. A leak of any of these is the same class of failure. */
const SECRET_VARIABLES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL_SESSION',
  'DATABASE_URL_TRANSACTION',
]

/** From `refuseBrowser()` in packages/db/src/env.ts. Its presence means that module was bundled. */
const ENV_MODULE_SENTINEL = '@folio/db/env was imported in a browser'

/** Shorter than this and a "value" is a placeholder that would match everything. */
const MIN_VALUE_LENGTH = 12

const needles = () => {
  const list = [
    {
      label: 'the @folio/db/env module (its browser-refusal message)',
      text: ENV_MODULE_SENTINEL,
      kind: 'module',
    },
  ]

  for (const name of SECRET_VARIABLES) {
    list.push({ label: `the name ${name}`, text: name, kind: 'name' })

    const value = process.env[name]
    if (typeof value === 'string' && value.length >= MIN_VALUE_LENGTH) {
      list.push({ label: `the VALUE of ${name}`, text: value, kind: 'value' })
    }
  }

  return list
}

const CLIENT_FILE = /\.(?:js|mjs|cjs|css|map)$/
const SERVED_FILE = /\.(?:html|rsc|json)$/

const walk = (dir, keep, found = []) => {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path, keep, found)
    } else if (keep(entry.name)) {
      found.push(path)
    }
  }
  return found
}

const main = () => {
  try {
    statSync(BUILD_DIR)
  } catch {
    console.error(
      '\nFolio: no .next directory. This script checks build output, so run `next build` first.\n',
    )
    process.exit(1)
  }

  const files = [
    ...walk(join(BUILD_DIR, 'static'), (name) => CLIENT_FILE.test(name)),
    ...walk(join(BUILD_DIR, 'server'), (name) => SERVED_FILE.test(name)),
  ]

  const wanted = needles()
  const findings = []

  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const needle of wanted) {
      const at = text.indexOf(needle.text)
      if (at !== -1) {
        findings.push({ file: relative(WEB_ROOT, file), needle, at })
      }
    }
  }

  const values = wanted.filter((needle) => needle.kind === 'value').length

  if (findings.length === 0) {
    console.log(
      `Folio: checked ${String(files.length)} client-served files. No server secret found.\n` +
        `       Needles: ${String(wanted.length)} (${String(values)} literal value${values === 1 ? '' : 's'}; the rest are names).`,
    )
    return
  }

  console.error('')
  console.error('  A SERVER SECRET IS IN THE CLIENT BUILD.')
  console.error('')
  console.error(
    '  AGENTS.md, Tenancy and data access: "The service-role key must never reach',
  )
  console.error('  the browser." It bypasses RLS, so a copy of it in a bundle is read and')
  console.error('  write access to every project in the database.')
  console.error('')
  for (const finding of findings) {
    console.error(`  ${finding.file}`)
    console.error(`      contains ${finding.needle.label}, at byte ${String(finding.at)}`)
  }
  console.error('')
  if (findings.some((finding) => finding.needle.kind === 'value')) {
    console.error('  A literal VALUE matched. Treat the key as public:')
    console.error('  rotate it in the Supabase dashboard NOW, then fix the code.')
    console.error('')
  }
  console.error('  Usual cause: a module that reads the environment was pulled into a')
  console.error('  Client Component - directly, or through something it imports. Server')
  console.error('  code belongs behind a server action or a Server Component; the browser')
  console.error('  gets NEXT_PUBLIC_ values only, from apps/web/lib/env/public.ts.')
  console.error('')
  console.error('  The matched text is deliberately not printed. A CI log is not a vault.')
  console.error('')
  process.exit(1)
}

main()
