import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, inject, it } from 'vitest'

import { assistantClient, modelClientOf } from '../lib/assistant/client'
import { pickFixtures } from './fixtures'
import { ASSISTANT_MODEL, readCraftRules, runStoryEval } from './harness'
import type { StoryResult } from './report'
import { buildReport } from './report'

declare module 'vitest' {
  export interface ProvidedContext {
    evalUser: string | null
    evalStories: string | null
  }
}

/**
 * `pnpm eval` - roadmap task 5.5. Runs every fixture (or `EVAL_STORIES`)
 * through `story_to_script` against a scratch project, scores each, and writes
 * `evals/reports/story-to-script-<time>.md` for a person to read. It is one
 * test so a run is one report; it fails only when the harness cannot run at
 * all (no model key, no eval account) - a low score is a finding for the
 * report, not a failure.
 */

it('story to script, scored against the craft rules', async () => {
  const user = inject('evalUser')
  const anthropic = assistantClient()
  if (user === null || anthropic === null) {
    throw new Error('The evals need ANTHROPIC_API_KEY and EVAL_USER_EMAIL (an account that exists) in the environment or apps/web/.env. See apps/web/evals/README.md.')
  }
  const picked = pickFixtures(inject('evalStories'))
  if (!picked.ok) throw new Error(picked.message)

  const startedAt = new Date().toISOString()
  const rules = await readCraftRules()
  expect(rules.length).toBeGreaterThan(0)
  const client = modelClientOf(anthropic)
  const results: StoryResult[] = []
  for (const fixture of picked.fixtures) {
    console.log(`eval: ${fixture.id} (${fixture.kind})`)
    results.push(await runStoryEval(fixture, rules, { client, userEmail: user, log: (line) => console.log(line) }))
  }

  const report = buildReport({ startedAt, model: ASSISTANT_MODEL, rules, results })
  const dir = join(process.cwd(), 'evals', 'reports')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `story-to-script-${startedAt.replace(/[:.]/gu, '-')}.md`)
  await writeFile(file, report, 'utf8')
  console.log(`eval: report written to ${file}`)
})
