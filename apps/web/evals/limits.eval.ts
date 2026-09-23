import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  addAgentRunTokens,
  cancelBackgroundRun,
  createAgentRun,
  createChat,
  createProjectFor,
  grantRunBudget,
  openProjectForWorker,
  readAgentRun,
  readUserIdByEmail,
  sessionDatabase,
  spendRunBudget,
  startBackgroundRun,
  tokensTodayFor,
  trashProject,
} from '@folio/db'
import type { RunId } from '@folio/script'
import { expect, inject, it } from 'vitest'

import { CONCURRENT_RUNS_PER_PROJECT, RATE_LIMITS } from '../lib/agent/limits'
import { checkRateLimit } from '../lib/agent/rate-limit'

declare module 'vitest' {
  export interface ProvidedContext {
    evalUser: string | null
    evalStories: string | null
  }
}

/**
 * The limits under load - roadmap task 5.6, ADR 0003 **D3** and **D14**. Not
 * a unit test: every limit is a statement in Postgres (a fixed-window counter,
 * an advisory lock, a conditional update against a CHECK), and whether it
 * holds when requests race is a property of the database, so this runs
 * against the one `.env` points at, as `EVAL_USER_EMAIL`, in a scratch project
 * `eval · limits · <time>`. On demand (`pnpm eval:limits`), never in CI.
 *
 * Each check fires more concurrent requests than the limit allows and counts
 * what got through - exactly the limit, never one more - and writes
 * `evals/reports/limits-<time>.md`. The background runs it starts are
 * cancelled at once, and the scratch project goes to the Trash when it is
 * done - reversible, as trashing is; purging is nobody's but the owner's.
 */

const settledCount = <T>(results: readonly PromiseSettledResult<T>[], accept: (value: T) => boolean): { readonly passed: number; readonly refused: number; readonly errors: number } => ({
  passed: results.filter((result) => result.status === 'fulfilled' && accept(result.value)).length,
  refused: results.filter((result) => result.status === 'fulfilled' && !accept(result.value)).length,
  errors: results.filter((result) => result.status === 'rejected').length,
})

it('the rate limits, the run cap, the credit budget and the token meter hold under concurrent load', async () => {
  const email = inject('evalUser')
  if (email === null) throw new Error('Set EVAL_USER_EMAIL to an account that exists. See apps/web/evals/README.md.')
  const db = await sessionDatabase()
  const user = await readUserIdByEmail(db, email)
  if (user === null) throw new Error(`No Folio account for ${email}.`)
  const startedAt = new Date().toISOString()
  const { project, episode } = await createProjectFor(db, user, { title: `eval · limits · ${startedAt.slice(0, 16)}`, kind: 'screenwriting', projectType: 'film', format: 'hollywood', logline: null })
  const scope = await openProjectForWorker(project.id, user)
  // To the Trash however the checks end - a failed expectation included.
  try {
    const lines: string[] = [`# Limits under load - ${startedAt}`, '', `Scratch project \`${project.id}\`, as ${email}.`, '', '| Check | Fired | Limit | Passed | Refused | Errors |', '| --- | --- | --- | --- | --- | --- |']

    // D14: 60 assistant requests an hour per user per project; 30 generate actions.
    for (const [bucket, fired] of [
      ['assistant', 100],
      ['generate', 45],
    ] as const) {
      const results = await Promise.allSettled(Array.from({ length: fired }, () => checkRateLimit(scope, user, bucket)))
      const count = settledCount(results, (value) => value === null)
      lines.push(`| ${bucket} requests in one window | ${String(fired)} | ${String(RATE_LIMITS[bucket])} | ${String(count.passed)} | ${String(count.refused)} | ${String(count.errors)} |`)
      expect(count).toEqual({ passed: RATE_LIMITS[bucket], refused: fired - RATE_LIMITS[bucket], errors: 0 })
    }

    // D14: two live background runs per project, however many start at once.
    const starts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        startBackgroundRun(scope, { episodeId: episode.id, title: `Load ${String(index)}`, brief: 'A load check. Do nothing.', input: { kind: 'task', title: `Load ${String(index)}`, task: 'Do nothing.', route: null, scope: 'episode' }, limit: CONCURRENT_RUNS_PER_PROJECT }),
      ),
    )
    const started = starts.flatMap((result) => (result.status === 'fulfilled' && result.value.status === 'started' ? [result.value.runId] : []))
    await Promise.all(started.map((runId) => cancelBackgroundRun(scope, runId)))
    const runCount = settledCount(starts, (value) => value.status === 'started')
    lines.push(`| background runs started at once | 6 | ${String(CONCURRENT_RUNS_PER_PROJECT)} | ${String(runCount.passed)} | ${String(runCount.refused)} | ${String(runCount.errors)} |`)
    expect(runCount).toEqual({ passed: CONCURRENT_RUNS_PER_PROJECT, refused: 6 - CONCURRENT_RUNS_PER_PROJECT, errors: 0 })

    // D3: a run spends only what a confirmation granted, however many spends race.
    const chat = await createChat(scope, episode.id)
    const run = await createAgentRun(scope, { episodeId: episode.id, chatId: chat.id, mode: 'interactive' })
    const runId = run.id as RunId
    await grantRunBudget(scope, runId, 400)
    const spends = await Promise.allSettled(Array.from({ length: 20 }, () => spendRunBudget(scope, runId, 40)))
    const spendCount = settledCount(spends, (value) => value)
    const after = await readAgentRun(scope, runId)
    lines.push(`| 40-credit spends against a 400 grant | 20 | 10 | ${String(spendCount.passed)} | ${String(spendCount.refused)} | ${String(spendCount.errors)} |`)
    expect(spendCount).toEqual({ passed: 10, refused: 10, errors: 0 })
    expect(after).toMatchObject({ creditBudget: 400, creditsSpent: 400 })

    // D3: the daily token meter adds every concurrent increment, none lost.
    const before = await tokensTodayFor(db, user)
    await Promise.all(Array.from({ length: 20 }, () => addAgentRunTokens(scope, runId, 700, 300)))
    const metered = (await tokensTodayFor(db, user)) - before
    lines.push(`| 1,000-token increments to the meter | 20 | - | ${String(metered / 1_000)} landed | - | - |`)
    expect(metered).toBe(20_000)

    lines.push('', 'Every limit admitted exactly its number and no more; the budget CHECK held (spent = granted); the token meter lost no increment.')
    const dir = join(process.cwd(), 'evals', 'reports')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `limits-${startedAt.replace(/[:.]/gu, '-')}.md`)
    await writeFile(file, lines.join('\n'), 'utf8')
    console.log(`eval: limits report written to ${file}`)
  } finally {
    await trashProject(scope)
  }
})
