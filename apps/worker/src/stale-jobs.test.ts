import type { JobId, JobKind } from '@folio/contracts'
import { projectId } from '@folio/contracts'
import type { CancelJobResult, QueuedJob } from '@folio/db'
import { describe, expect, it, vi } from 'vitest'

import { cancelStaleJobs, parseStaleJobsArgs } from './stale-jobs'

/**
 * The pre-deploy stale-job sweep (`scripts/cancel-stale-jobs.ts`). The list
 * and the cancel are stand-ins; the policy is the real one: nothing is written
 * without `--confirm`, only frame jobs go through `cancelJob`, and each
 * outcome is said.
 */

const PROJECT = projectId('00000000-0000-4000-8000-000000000001')

const job = (id: string, kind: JobKind, cost: number): QueuedJob => ({
  id: id as JobId,
  projectId: PROJECT,
  kind,
  cost,
  createdBy: null,
  createdAt: '2026-09-12 10:00:00.000000+00',
})

const BEFORE = new Date('2026-09-20T00:00:00.000Z')

const run = async (jobs: readonly QueuedJob[], confirm: boolean, cancel: (job: QueuedJob) => Promise<CancelJobResult> = () => Promise.resolve({ status: 'cancelled', released: 4, available: 100 })) => {
  const lines: string[] = []
  const list = vi.fn(() => Promise.resolve(jobs))
  const cancelSpy = vi.fn(cancel)
  const report = await cancelStaleJobs({ list, cancel: cancelSpy, print: (line) => lines.push(line) }, { before: BEFORE, confirm })
  return { report, lines, list, cancel: cancelSpy }
}

describe('the arguments', () => {
  it('takes --before as a date or a timestamp, and --confirm', () => {
    expect(parseStaleJobsArgs(['--before', '2026-09-20'])).toEqual({ ok: true, args: { before: new Date('2026-09-20'), confirm: false } })
    expect(parseStaleJobsArgs(['--before=2026-09-20T12:00:00Z', '--confirm'])).toEqual({ ok: true, args: { before: new Date('2026-09-20T12:00:00Z'), confirm: true } })
  })

  it('refuses a missing date, something that is not one, and anything unknown', () => {
    expect(parseStaleJobsArgs([]).ok).toBe(false)
    expect(parseStaleJobsArgs(['--confirm']).ok).toBe(false)
    expect(parseStaleJobsArgs(['--before', '5']).ok).toBe(false)
    expect(parseStaleJobsArgs(['--before', '2026-13-45']).ok).toBe(false)
    expect(parseStaleJobsArgs(['--before', 'yesterday']).ok).toBe(false)
    // A typo of --confirm must not become a dry run the operator reads as done.
    expect(parseStaleJobsArgs(['--before', '2026-09-20', '--confirmed'])).toMatchObject({ ok: false, message: expect.stringContaining('Unknown argument --confirmed') })
  })
})

describe('the sweep', () => {
  const FRAMES = [job('a', 'frame_generation', 4), job('b', 'frame_generation', 4)]

  it('lists what it found before the date, and writes nothing without --confirm', async () => {
    const { report, lines, list, cancel } = await run([...FRAMES, job('c', 'production_generation', 0)], false)
    expect(list).toHaveBeenCalledWith(BEFORE)
    expect(cancel).not.toHaveBeenCalled()
    expect(report).toEqual({ listed: 3, cancelled: 0, released: 0, left: 1, missed: 0, failed: 0 })
    expect(lines[0]).toBe('3 queued jobs queued before 2026-09-20T00:00:00.000Z.')
    expect(lines.some((line) => line.includes('a  frame_generation') && line.includes('cost 4'))).toBe(true)
    expect(lines).toContain('Dry run: would cancel 2 frame jobs and release up to 8 credits; 1 left. Nothing was written.')
    expect(lines).toContain('Run again with --confirm to cancel them.')
  })

  it('cancels each frame job through cancelJob with --confirm, and says what was released', async () => {
    const { report, lines, cancel } = await run(FRAMES, true)
    expect(cancel.mock.calls.map(([entry]) => entry.id)).toEqual(['a', 'b'])
    expect(report).toEqual({ listed: 2, cancelled: 2, released: 8, left: 0, missed: 0, failed: 0 })
    expect(lines).toContain('  cancelled: a, 4 credits released')
    expect(lines.at(-1)).toBe('Cancelled 2 frame jobs, released 8 credits; 0 not cancelled (0 failed), 0 left.')
  })

  it('leaves a generation or a run job alone, naming the cancel that settles it', async () => {
    const { report, lines, cancel } = await run([job('g', 'production_generation', 0), job('r', 'agent_run', 0)], true)
    expect(cancel).not.toHaveBeenCalled()
    expect(report.left).toBe(2)
    expect(lines.some((line) => line.startsWith('  left: g is production_generation') && line.includes('cancelGeneration'))).toBe(true)
    expect(lines.some((line) => line.startsWith('  left: r is agent_run') && line.includes('cancelBackgroundRun'))).toBe(true)
  })

  it('says when a job started, ended or vanished between the list and the cancel, and carries on past a failure', async () => {
    const outcomes: (CancelJobResult | Error)[] = [
      { status: 'requested', cost: 4 },
      { status: 'already-over', was: 'finished' },
      new Error('connection reset'),
      { status: 'no-job' },
      { status: 'cancelled', released: 4, available: 50 },
    ]
    const jobs = ['p', 'q', 'r', 's', 't'].map((id) => job(id, 'frame_generation', 4))
    const { report, lines } = await run(jobs, true, () => {
      const next = outcomes.shift()
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? { status: 'no-job' })
    })
    expect(report).toEqual({ listed: 5, cancelled: 1, released: 4, left: 0, missed: 4, failed: 1 })
    expect(lines).toContain('  running now: p was asked to stop; the worker settles its 4 credits')
    expect(lines).toContain('  already finished: q')
    expect(lines).toContain('  failed: r - connection reset')
    expect(lines).toContain('  gone: s')
  })

  it('says so when there is nothing to do', async () => {
    const { report, lines } = await run([], false)
    expect(report.listed).toBe(0)
    expect(lines).toEqual(['0 queued jobs queued before 2026-09-20T00:00:00.000Z.', 'Dry run: would cancel 0 frame jobs and release up to 0 credits; 0 left. Nothing was written.'])
  })
})
