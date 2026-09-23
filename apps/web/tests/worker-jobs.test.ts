// @vitest-environment node
import { jobId, productionGenerationId, projectId, userId } from '@folio/contracts'
import type { ClaimedJob, OrphanedReservation, ProjectScope } from '@folio/db'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The worker's Production jobs and its two clocks - roadmap task 4.3.
 *
 * The database, the runner, the model and the bucket are mocked; what is held
 * is what each piece decides. The generation handler runs the spec the row was
 * quoted for, reads the job's ending back off the generation, stops the
 * provider only on a cancel, and fails the generation as interrupted when the
 * stale sweep gives up on it. The reaper fails a generation left with no live
 * job, releases what a finished owner never closed under the one release key,
 * and never releases a reservation that names no job. The sweeper looks only
 * at Production objects a day old, logs by default, and when deleting removes
 * the rows first and then only the objects whose rows went.
 */

type Spy = Mock<(...args: readonly unknown[]) => unknown>

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  runGeneration: vi.fn(),
  readReelView: vi.fn(),
  readCastAndPlaces: vi.fn(),
  storage: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  sweepDelete: { value: false },
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = [
    'openProjectForWorker',
    'readGenerationForRun',
    'failGeneration',
    'appendLedgerEntry',
    'listOrphanedReservations',
    'listProjectsHoldingReservations',
    'sessionDatabase',
    'listUnreferencedAssetKeys',
    'deleteUnreferencedAssets',
  ]
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})
vi.mock('@folio/db/env', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  workerEnv: {
    get R2_SWEEP_DELETE() {
      return spies.sweepDelete.value
    },
  },
}))
vi.mock('../lib/production/pipeline/runner', () => ({ runGeneration: (...args: readonly unknown[]) => spies.runGeneration(...args) }))
vi.mock('../lib/production/core', () => ({ readReelView: (...args: readonly unknown[]) => spies.readReelView(...args) }))
vi.mock('../lib/production/compose', () => ({ readCastAndPlaces: (...args: readonly unknown[]) => spies.readCastAndPlaces(...args) }))
vi.mock('../lib/storage/r2', () => {
  const names = ['listObjects', 'deleteObject', 'storageAvailable', 'publicUrl', 'putObject']
  for (const name of names) spies.storage[name] = vi.fn()
  return Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.storage[name]?.(...args)]))
})

const { productionGenerationHandler, outcomeOfGeneration, INTERRUPTED } = await import('../lib/worker/production-generation')
const { reapProject, reaper } = await import('../lib/worker/reaper')
const { sweepable, sweepProject, sweeper, SWEEP_AGE_MS } = await import('../lib/worker/sweeper')

const db = (name: string): Spy => {
  const spy = spies.db[name]
  if (spy === undefined) throw new Error(`no spy ${name}`)
  return spy
}
const storage = (name: string): Spy => {
  const spy = spies.storage[name]
  if (spy === undefined) throw new Error(`no spy ${name}`)
  return spy
}

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const OTHER = projectId('7a2d5b4f-3c8e-4d2f-8b66-1e5a4c3b2d21')
const WRITER = userId('7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b')
const GENERATION = productionGenerationId('8b3e6c5a-4d9f-4e3a-9c77-2f6b5d4c3e32')
const REEL = '9c4f7d6b-5eaf-4f4b-8d88-3a7c6e5d4f43'
const SCOPE = { projectId: PROJECT } as ProjectScope

const job = (payload: unknown = { generationId: GENERATION }): ClaimedJob => ({
  id: jobId('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
  projectId: PROJECT,
  kind: 'production_generation',
  payload,
  createdBy: WRITER,
  attempts: 1,
  cost: 0,
  lease: '2026-09-23 10:00:00.000001+00',
})

const STORED_PROMPT = { text: 'Harbour at night, wide.', references: [], aspect: '16:9', durationS: null }

const run = (over: Record<string, unknown> = {}) => ({
  id: GENERATION,
  job: 'shot_frame',
  targetType: 'reel_shot',
  targetId: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  state: 'queued',
  refusalReason: null,
  error: null,
  prompt: STORED_PROMPT,
  settingsSnapshot: { tier: 'standard' },
  sourceHash: 'hash-1',
  route: 'gemini-image',
  createdBy: WRITER,
  ...over,
})

const signalOf = () => new AbortController()

beforeEach(() => {
  vi.clearAllMocks()
  spies.sweepDelete.value = false
  db('openProjectForWorker').mockResolvedValue(SCOPE)
  db('failGeneration').mockResolvedValue({ id: GENERATION })
  spies.runGeneration.mockResolvedValue(undefined)
  spies.readReelView.mockResolvedValue({ id: REEL })
  spies.readCastAndPlaces.mockResolvedValue({ names: [{ id: 'c1', name: 'MEERA' }] })
})

// ---------------------------------------------------------------------------
// The Production generation handler
// ---------------------------------------------------------------------------

describe('productionGenerationHandler', () => {
  it('runs the spec the row was quoted for, as the job starter, and reads the ending off the generation', async () => {
    db('readGenerationForRun').mockResolvedValueOnce(run()).mockResolvedValueOnce(run({ state: 'succeeded' }))
    const outcome = await productionGenerationHandler.run({ job: job(), signal: signalOf().signal })

    expect(db('openProjectForWorker')).toHaveBeenCalledWith(PROJECT, WRITER)
    expect(spies.runGeneration).toHaveBeenCalledTimes(1)
    const input = spies.runGeneration.mock.calls[0]?.[0] as Record<string, unknown>
    expect(input).toMatchObject({ scope: SCOPE, id: GENERATION, reel: null, names: [] })
    expect(input['spec']).toMatchObject({ job: 'shot_frame', prompt: 'Harbour at night, wide.', route: 'gemini-image', sourceHash: 'hash-1', settings: { tier: 'standard' } })
    expect(spies.readReelView).not.toHaveBeenCalled()
    expect(spies.readCastAndPlaces).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'finished' })
  })

  it('re-reads the reel a sheet is drawn from, and the cast names a shotlist is parsed with', async () => {
    db('readGenerationForRun')
      .mockResolvedValueOnce(run({ job: 'ai_shotlist', targetType: 'reel', targetId: REEL }))
      .mockResolvedValueOnce(run({ job: 'ai_shotlist', targetType: 'reel', targetId: REEL, state: 'succeeded' }))
    await productionGenerationHandler.run({ job: job(), signal: signalOf().signal })

    expect(spies.readReelView).toHaveBeenCalledWith(SCOPE, REEL)
    const input = spies.runGeneration.mock.calls[0]?.[0] as Record<string, unknown>
    expect(input).toMatchObject({ reel: { id: REEL }, names: [{ id: 'c1', name: 'MEERA' }] })
  })

  it('does not run a generation that is already over - cancelled while it waited', async () => {
    db('readGenerationForRun').mockResolvedValueOnce(run({ state: 'cancelled' }))
    const outcome = await productionGenerationHandler.run({ job: job(), signal: signalOf().signal })
    expect(spies.runGeneration).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'cancelled' })
  })

  it('fails the generation, rather than running something else, when the stored spec does not read', async () => {
    db('readGenerationForRun').mockResolvedValueOnce(run({ prompt: 'not a stored prompt' })).mockResolvedValueOnce(run({ state: 'failed', error: 'The stored spec did not read.' }))
    const outcome = await productionGenerationHandler.run({ job: job(), signal: signalOf().signal })
    expect(spies.runGeneration).not.toHaveBeenCalled()
    expect(db('failGeneration')).toHaveBeenCalledWith(SCOPE, GENERATION, 'The stored spec did not read.')
    expect(outcome).toEqual({ status: 'failed', error: 'The stored spec did not read.' })
  })

  it('fails a job whose payload names no generation, touching nothing', async () => {
    const outcome = await productionGenerationHandler.run({ job: job({ nope: true }), signal: signalOf().signal })
    expect(outcome).toEqual({ status: 'failed', error: 'The job names no generation.' })
    expect(db('readGenerationForRun')).not.toHaveBeenCalled()
  })

  it('stops the provider on a cancel, and not on a shutdown or a lost lease', async () => {
    const seen: AbortSignal[] = []
    spies.runGeneration.mockImplementation((input: { readonly signal: AbortSignal }) => {
      seen.push(input.signal)
      return Promise.resolve()
    })
    db('readGenerationForRun').mockResolvedValue(run())

    for (const reason of ['shutdown', 'lost', 'cancel']) {
      const controller = signalOf()
      await productionGenerationHandler.run({ job: job(), signal: controller.signal })
      controller.abort(reason)
    }
    expect(seen.map((signal) => signal.aborted)).toEqual([false, false, true])
  })

  it('fails the generation as interrupted when the stale sweep abandons the job', async () => {
    await productionGenerationHandler.abandon?.(job(), 'Stopped after 3 attempts without finishing.')
    expect(db('failGeneration')).toHaveBeenCalledWith(SCOPE, GENERATION, INTERRUPTED)
    expect(INTERRUPTED).toBe('interrupted')
  })

  it('maps each ending of a generation to the job status the jobs table records', () => {
    expect(outcomeOfGeneration(run({ state: 'succeeded' }) as never)).toEqual({ status: 'finished' })
    expect(outcomeOfGeneration(run({ state: 'refused', refusalReason: 'Flagged.' }) as never)).toEqual({ status: 'blocked', reason: 'Flagged.' })
    expect(outcomeOfGeneration(run({ state: 'failed', error: 'Timed out.' }) as never)).toEqual({ status: 'failed', error: 'Timed out.' })
    expect(outcomeOfGeneration(run({ state: 'cancelled' }) as never)).toEqual({ status: 'cancelled' })
    expect(outcomeOfGeneration(run({ state: 'running' }) as never)).toEqual({ status: 'failed', error: 'The generation did not settle.' })
    expect(outcomeOfGeneration(null)).toEqual({ status: 'failed', error: 'The generation is gone.' })
  })
})

// ---------------------------------------------------------------------------
// The reaper
// ---------------------------------------------------------------------------

const orphan = (owner: OrphanedReservation['owner'], entryJobId: string | null, delta = -4): OrphanedReservation =>
  ({
    entry: { id: `entry-${String(entryJobId)}`, projectId: PROJECT, kind: 'reserve', delta, jobId: entryJobId, idempotencyKey: `reserve:job:${String(entryJobId)}`, externalRef: null, reason: null, createdBy: WRITER, occurredAt: '2026-09-23T09:00:00Z' },
    owner,
  }) as OrphanedReservation

describe('the reaper', () => {
  it('fails a generation left with no live job as interrupted, and releases what a finished owner never closed', async () => {
    const LIVE = '10000000-0000-4000-8000-000000000001'
    const OVER = '10000000-0000-4000-8000-000000000002'
    const FRAME = '10000000-0000-4000-8000-000000000003'
    const GONE = '10000000-0000-4000-8000-000000000004'
    db('listOrphanedReservations').mockResolvedValue([
      orphan({ kind: 'generation', id: LIVE, state: 'running' }, LIVE),
      orphan({ kind: 'generation', id: OVER, state: 'succeeded' }, OVER, -12),
      orphan({ kind: 'job', id: jobId(FRAME), status: 'failed' }, FRAME),
      orphan({ kind: 'none' }, GONE),
    ])
    const log = vi.fn()
    const reaped = await reapProject(SCOPE, log)

    expect(db('failGeneration')).toHaveBeenCalledTimes(1)
    expect(db('failGeneration')).toHaveBeenCalledWith(SCOPE, LIVE, 'interrupted')
    const releases = db('appendLedgerEntry').mock.calls.map((call) => call[1])
    expect(releases).toEqual([
      expect.objectContaining({ kind: 'release', delta: 12, jobId: OVER, idempotencyKey: `release:job:${OVER}` }),
      expect.objectContaining({ kind: 'release', delta: 4, jobId: FRAME, idempotencyKey: `release:job:${FRAME}` }),
      expect.objectContaining({ kind: 'release', delta: 4, jobId: GONE, idempotencyKey: `release:job:${GONE}` }),
    ])
    expect(reaped).toEqual({ interrupted: 1, released: 3, skipped: 0 })
    expect(log).not.toHaveBeenCalled()
  })

  it('never releases a reservation that names no job - it logs it', async () => {
    db('listOrphanedReservations').mockResolvedValue([orphan({ kind: 'none' }, null)])
    const log = vi.fn()
    const reaped = await reapProject(SCOPE, log)
    expect(db('appendLedgerEntry')).not.toHaveBeenCalled()
    expect(reaped).toEqual({ interrupted: 0, released: 0, skipped: 1 })
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'folio.reaper.unkeyed_reservation', projectId: PROJECT }))
  })

  it('does not count a generation that settled between the read and the write', async () => {
    db('listOrphanedReservations').mockResolvedValue([orphan({ kind: 'generation', id: GENERATION, state: 'queued' }, GENERATION)])
    db('failGeneration').mockResolvedValue(null)
    expect(await reapProject(SCOPE, vi.fn())).toEqual({ interrupted: 0, released: 0, skipped: 0 })
    expect(db('appendLedgerEntry')).not.toHaveBeenCalled()
  })

  it('walks every project holding a reservation, as no one, and reports only what it closed', async () => {
    db('sessionDatabase').mockResolvedValue({})
    db('listProjectsHoldingReservations').mockResolvedValue([PROJECT, OTHER])
    db('listOrphanedReservations').mockResolvedValueOnce([orphan({ kind: 'none' }, GENERATION)]).mockResolvedValueOnce([])
    const log = vi.fn()
    await reaper.run(log)
    expect(db('openProjectForWorker').mock.calls).toEqual([
      [PROJECT, null],
      [OTHER, null],
    ])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith({ event: 'folio.reaper.reaped', projectId: PROJECT, interrupted: 0, released: 1, skipped: 0 })
    expect(reaper.everyMs).toBe(10 * 60 * 1000)
  })
})

// ---------------------------------------------------------------------------
// The R2 sweeper
// ---------------------------------------------------------------------------

describe('the R2 sweeper', () => {
  const NOW = new Date('2026-09-23T12:00:00Z')
  const old = new Date(NOW.getTime() - SWEEP_AGE_MS - 1)
  const fresh = new Date(NOW.getTime() - SWEEP_AGE_MS + 60_000)

  it('looks only at Production objects older than a day, by project', () => {
    const found = sweepable(
      [
        { key: `projects/${PROJECT}/production/still/a.png`, size: 1, lastModified: old },
        { key: `projects/${PROJECT}/production/clip/b.mp4`, size: 1, lastModified: fresh },
        { key: `projects/${PROJECT}/characters/c1/portrait-c.png`, size: 1, lastModified: old },
        { key: `projects/${OTHER}/production/reference/d.png`, size: 1, lastModified: old },
        { key: 'projects/not-a-project/production/still/e.png', size: 1, lastModified: old },
      ],
      NOW,
    )
    expect([...found.entries()]).toEqual([
      [PROJECT, [`projects/${PROJECT}/production/still/a.png`]],
      [OTHER, [`projects/${OTHER}/production/reference/d.png`]],
    ])
  })

  it('logs what nothing points at and deletes nothing by default', async () => {
    db('listUnreferencedAssetKeys').mockResolvedValue([{ key: 'k1', assetId: 'asset-1' }])
    const log = vi.fn()
    expect(await sweepProject(SCOPE, ['k1', 'k2'], false, log)).toEqual({ unreferenced: 1, deleted: 0 })
    expect(db('listUnreferencedAssetKeys')).toHaveBeenCalledWith(SCOPE, ['k1', 'k2'])
    expect(db('deleteUnreferencedAssets')).not.toHaveBeenCalled()
    expect(storage('deleteObject')).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'folio.sweeper.unreferenced', keys: ['k1'], deleting: false }))
  })

  it('when told to delete, removes the rows first and then only the objects whose rows went', async () => {
    db('listUnreferencedAssetKeys').mockResolvedValue([
      { key: 'kept-by-a-redraw', assetId: 'asset-1' },
      { key: 'gone', assetId: 'asset-2' },
      { key: 'never-a-row', assetId: null },
    ])
    db('deleteUnreferencedAssets').mockResolvedValue(['asset-2'])
    storage('deleteObject').mockResolvedValue({ ok: true })
    expect(await sweepProject(SCOPE, ['x'], true, vi.fn())).toEqual({ unreferenced: 3, deleted: 2 })
    expect(db('deleteUnreferencedAssets')).toHaveBeenCalledWith(SCOPE, ['asset-1', 'asset-2'])
    expect(storage('deleteObject').mock.calls).toEqual([['gone'], ['never-a-row']])
  })

  it('does nothing without storage, and carries on after the last key of a cut-short listing', async () => {
    storage('storageAvailable').mockReturnValue(false)
    await sweeper.run(vi.fn())
    expect(storage('listObjects')).not.toHaveBeenCalled()

    storage('storageAvailable').mockReturnValue(true)
    storage('listObjects')
      .mockResolvedValueOnce({ ok: true, objects: [{ key: 'projects/x/other/last.png', size: 1, lastModified: old }], truncated: true })
      .mockResolvedValueOnce({ ok: true, objects: [], truncated: false })
      .mockResolvedValueOnce({ ok: true, objects: [], truncated: false })
    const log = vi.fn()
    await sweeper.run(log)
    await sweeper.run(log)
    await sweeper.run(log)
    expect(storage('listObjects').mock.calls.map((call) => (call[1] as { readonly startAfter: string | null }).startAfter)).toEqual([null, 'projects/x/other/last.png', null])
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'folio.sweeper.swept', listed: 1, more: true }))
  })
})
