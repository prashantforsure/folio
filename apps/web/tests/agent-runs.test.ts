// @vitest-environment node
import type { AgentEvent, AgentRoute, AgentRun, Episode, Project } from '@folio/contracts'
import { assistantChatId, episodeId, episodeSlug, projectId, userId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { runId } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProposedOp, ToolContext } from '../lib/agent/registry'
import type { ProposalFacts } from '../lib/agent/runs'

/**
 * Starting, watching, cancelling and replying to a background run - roadmap
 * task 4.4, ADR 0003 **D4** and **D14**.
 *
 * `start_background_task` is a direct tool: it writes the run and its job
 * through `startBackgroundRun`, reading what the turn read (the route decides
 * the scope), refuses a third live run on the project with the count (D14),
 * and tells the panel with a `background_run` event; undoing it cancels a run
 * still going. The run card's core functions let anyone who reads the project
 * watch, the starter or an owner cancel, and only the starter reply - the run
 * acts as them - with a note of what became of the proposals it paused on.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  checkRateLimit: vi.fn(),
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['startBackgroundRun', 'cancelBackgroundRun', 'continueBackgroundRun', 'readBackgroundRun', 'listRunProposals', 'countRunSteps', 'readMembershipFor', 'transactionDatabase']
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})
vi.mock('../lib/agent/rate-limit', () => ({ checkRateLimit: (...args: readonly unknown[]) => spies.checkRateLimit(...args) }))

const { startBackgroundTaskTool } = await import('../lib/agent/tools/writes-runs')
const { runTool } = await import('../lib/agent/registry')
const { cancelRunWith, continueRunWith, continuationNote, readRunViewWith, DEFAULT_REPLY } = await import('../lib/agent/runs')
const { CONCURRENT_RUNS_PER_PROJECT } = await import('../lib/agent/limits')

const db = (name: string): Mock<(...args: readonly unknown[]) => unknown> => {
  const spy = spies.db[name]
  if (spy === undefined) throw new Error(`no spy ${name}`)
  return spy
}

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const WRITER = userId('7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b')
const OTHER = userId('8f7e6d5c-4b3a-4f2e-8d1c-0b9a8f7e6d5c')
const RUN = runId('3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98')
const CHAT = assistantChatId('0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21')
const SCOPE = { projectId: PROJECT } as ProjectScope

const gate = (role: 'reader' | 'writer' | 'owner' = 'writer', actor = WRITER) => ({ actor, scope: SCOPE, project: { id: PROJECT } as Project, episode: EPISODE, role })

/** A turn's context whose `applyNow` applies the direct operation with its executor, as the sink does. */
const context = (route: AgentRoute | null, events: AgentEvent[], role: 'reader' | 'writer' = 'writer'): ToolContext => ({
  gate: gate(role),
  runId: runId('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'),
  idempotencyKey: 'toolu_start',
  emit: (event) => events.push(event),
  loaded: new Set(),
  route,
  membership: () => Promise.resolve(null),
  proposals: {
    propose: () => undefined,
    earlier: () => undefined,
    applyNow: async (op: ProposedOp) => {
      const outcome = await startBackgroundTaskTool.executor.run(
        { gate: gate(role), runId: RUN, proposalId: '00000000-0000-4000-8000-000000000001' as never, idempotencyKey: 'toolu_start', digests: new Map(), snapshots: new Map(), editorDocuments: new Set(), schedule: () => undefined },
        op.args,
        null,
      )
      return outcome.ok ? { ok: true, proposalId: '00000000-0000-4000-8000-000000000001', result: outcome.result } : { ok: false, message: outcome.message }
    },
  },
})

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: RUN,
  projectId: PROJECT,
  episodeId: EPISODE.id,
  chatId: CHAT,
  messageId: null,
  createdBy: WRITER,
  status: 'running',
  mode: 'background',
  inputTokens: 0,
  outputTokens: 0,
  creditBudget: 0,
  creditsSpent: 0,
  error: null,
  createdAt: '2026-09-23T09:59:00.000Z',
  startedAt: '2026-09-23T10:00:00.000Z',
  finishedAt: null,
  ...over,
})

const proposal = (status: ProposalFacts['proposal']['status'], needsConfirmation: boolean, summary = 'Rename ARJUN'): ProposalFacts => ({ proposal: { status, needsConfirmation, summary } })

const INPUT = { kind: 'task', title: 'Draft act two', task: 'Draft act two.', route: 'script', scope: 'episode' }

/** The stored operation's args, as the tool prepared them. */
const ARGS = { title: 'Draft act two', brief: 'Draft act two.', route: 'script', scope: 'episode' }

beforeEach(() => {
  vi.clearAllMocks()
  spies.checkRateLimit.mockResolvedValue(null)
  db('readBackgroundRun').mockResolvedValue({ run: run(), input: INPUT })
  db('listRunProposals').mockResolvedValue([])
  db('countRunSteps').mockResolvedValue(7)
})

describe('start_background_task', () => {
  it('writes the run and its job as the turn`s person, reading what the turn read, and tells the panel', async () => {
    db('startBackgroundRun').mockResolvedValue({ status: 'started', runId: RUN, chatId: CHAT })
    const events: AgentEvent[] = []
    const result = await runTool('start_background_task', { title: 'Check every character', brief: 'Give every character a one-line bio.' }, context('characters', events), [startBackgroundTaskTool.tool])
    expect(result.ok).toBe(true)
    expect(db('startBackgroundRun')).toHaveBeenCalledWith(SCOPE, {
      episodeId: EPISODE.id,
      title: 'Check every character',
      brief: 'Give every character a one-line bio.',
      // Characters reads the whole project, as the panel's turn there does.
      input: { kind: 'task', title: 'Check every character', task: 'Give every character a one-line bio.', route: 'characters', scope: 'project' },
      limit: CONCURRENT_RUNS_PER_PROJECT,
    })
    expect(events).toContainEqual({ type: 'background_run', runId: RUN, chatId: CHAT, title: 'Check every character' })
  })

  it('reads the episode from a script route', async () => {
    db('startBackgroundRun').mockResolvedValue({ status: 'started', runId: RUN, chatId: CHAT })
    await runTool('start_background_task', { title: 'Draft act two', brief: 'Draft act two.' }, context('script', []), [startBackgroundTaskTool.tool])
    expect(db('startBackgroundRun')).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ input: expect.objectContaining({ route: 'script', scope: 'episode' }) }))
  })

  it('refuses a third live run on the project with the count (D14), and tells the panel nothing', async () => {
    db('startBackgroundRun').mockResolvedValue({ status: 'busy', live: 2 })
    const events: AgentEvent[] = []
    const result = await runTool('start_background_task', { title: 'Another', brief: 'More.' }, context('script', events), [startBackgroundTaskTool.tool])
    expect(result).toEqual({ ok: false, message: 'This project already has 2 background runs working, which is the limit. Wait for one to finish, or cancel one.' })
    expect(events.filter((event) => event.type === 'background_run')).toEqual([])
  })

  it('refuses a reader before anything is written', async () => {
    const result = await runTool('start_background_task', { title: 'A', brief: 'B' }, context('script', [], 'reader'), [startBackgroundTaskTool.tool])
    expect(result.ok).toBe(false)
    expect(db('startBackgroundRun')).not.toHaveBeenCalled()
  })

  it('is undone by cancelling the run while it still goes, and left alone once it has finished', async () => {
    const invert = startBackgroundTaskTool.executor.invert
    expect(invert).not.toBeNull()
    const exec = { gate: gate(), runId: RUN } as never
    db('cancelBackgroundRun').mockResolvedValueOnce({ status: 'cancelled' })
    expect(await invert?.(exec, ARGS, { runId: RUN }, null)).toEqual({ kind: 'undone', note: 'The background run was cancelled.' })
    expect(db('cancelBackgroundRun')).toHaveBeenCalledWith(SCOPE, RUN)
    db('cancelBackgroundRun').mockResolvedValueOnce({ status: 'already-over' })
    expect(await invert?.(exec, ARGS, { runId: RUN }, null)).toMatchObject({ kind: 'skipped' })
  })
})

describe('the run card`s figures', () => {
  it('names the run, its steps, what it proposed and what waits for a confirmation', async () => {
    db('readBackgroundRun').mockResolvedValue({ run: run({ status: 'waiting_for_user', error: 'Waiting for you to confirm a proposal.' }), input: INPUT })
    db('listRunProposals').mockResolvedValue([proposal('pending', true), proposal('pending', false), proposal('applied', false)])
    const read = await readRunViewWith(gate('reader', OTHER), RUN)
    expect(read).toEqual({
      status: 'ok',
      run: expect.objectContaining({
        id: RUN,
        chatId: CHAT,
        title: 'Draft act two',
        status: 'waiting_for_user',
        note: 'Waiting for you to confirm a proposal.',
        steps: 7,
        proposals: { pending: 2, applied: 1, toConfirm: 1 },
        mine: false,
      }),
    })
  })

  it('finds no run for an id that is not one', async () => {
    expect((await readRunViewWith(gate(), 'not-a-run')).status).toBe('refused')
    db('readBackgroundRun').mockResolvedValue(null)
    expect((await readRunViewWith(gate(), RUN)).status).toBe('refused')
  })
})

describe('cancelling a run', () => {
  it('is its starter`s or an owner`s', async () => {
    db('cancelBackgroundRun').mockResolvedValue({ status: 'cancelled' })
    expect((await cancelRunWith(gate('writer', OTHER), RUN)).status).toBe('refused')
    expect(db('cancelBackgroundRun')).not.toHaveBeenCalled()
    expect((await cancelRunWith(gate('owner', OTHER), RUN)).status).toBe('ok')
    expect((await cancelRunWith(gate('writer', WRITER), RUN)).status).toBe('ok')
    expect(db('cancelBackgroundRun')).toHaveBeenCalledTimes(2)
  })
})

describe('replying to a run that waits', () => {
  beforeEach(() => {
    db('readBackgroundRun').mockResolvedValue({ run: run({ status: 'waiting_for_user' }), input: INPUT })
    db('continueBackgroundRun').mockResolvedValue({ status: 'queued' })
  })

  it('queues its next job with the writer`s words after a note of what became of the proposals it paused on', async () => {
    db('listRunProposals').mockResolvedValue([proposal('applied', true, 'Rename ARJUN'), proposal('rejected', true, 'Delete KAVYA'), proposal('pending', false, 'Add a scene')])
    expect((await continueRunWith(gate(), RUN, 'Now the second act.')).status).toBe('ok')
    expect(db('continueBackgroundRun')).toHaveBeenCalledWith(
      SCOPE,
      RUN,
      '[Folio: since the run paused, "Rename ARJUN" was applied; "Delete KAVYA" was rejected.]\n\nNow the second act.',
      CONCURRENT_RUNS_PER_PROJECT,
    )
    expect(spies.checkRateLimit).toHaveBeenCalledWith(SCOPE, WRITER, 'assistant')
  })

  it('carries on with a default reply when the writer says nothing', async () => {
    await continueRunWith(gate(), RUN, '   ')
    expect(db('continueBackgroundRun')).toHaveBeenCalledWith(SCOPE, RUN, DEFAULT_REPLY, CONCURRENT_RUNS_PER_PROJECT)
    expect(continuationNote([proposal('pending', false)])).toBeNull()
  })

  it('is the starter`s alone - the run acts as them - and only while it waits', async () => {
    expect(await continueRunWith(gate('owner', OTHER), RUN, 'Go')).toEqual({ status: 'refused', message: 'Only the person who started this run can reply to it. It acts as them.' })
    db('readBackgroundRun').mockResolvedValue({ run: run({ status: 'running' }), input: INPUT })
    expect(await continueRunWith(gate(), RUN, 'Go')).toEqual({ status: 'refused', message: 'This run is not waiting for a reply.' })
    expect(db('continueBackgroundRun')).not.toHaveBeenCalled()
  })

  it('answers the hourly limit, and a project already running its two', async () => {
    spies.checkRateLimit.mockResolvedValueOnce({ status: 'rate-limited', message: 'Slow down.', retryAfterSeconds: 60 })
    expect((await continueRunWith(gate(), RUN, 'Go')).status).toBe('rate-limited')
    db('continueBackgroundRun').mockResolvedValue({ status: 'busy', live: 2 })
    expect(await continueRunWith(gate(), RUN, 'Go')).toMatchObject({ status: 'refused', message: expect.stringContaining('2 background runs working') })
  })
})
