// @vitest-environment node
import type { Episode, Project, ProposalDocumentBase } from '@folio/contracts'
import { episodeId, episodeSlug, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { documentId } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { ProposedOp } from '../lib/agent/registry'
import { RUN, store } from './fake-proposals'

/**
 * Autonomy - roadmap task 3.7, ADR 0003 **D1**.
 *
 * `review` leaves every proposal pending. `auto` applies one the moment it is
 * made - a record-only proposal in the turn, a script or outline proposal by
 * the panel (so the open editor still writes it, D10) - and never one that
 * needs confirmation: `confirm` and `paid` always stop for a click. The
 * setting is the person's own, written only to their own row.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  ran: [] as string[],
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const { repository } = await import('./fake-proposals')
  const names = ['setAgentAutonomy', 'transactionDatabase', 'snapshotVersion', 'logAgentActivity', 'readDocumentById', 'readScreenplayNodes']
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...repository, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})
vi.mock('../lib/auth/session', async (actual) => ({ ...(await actual<Record<string, unknown>>()), requireUser: (...args: readonly unknown[]) => spies.requireUser(...args) }))
vi.mock('next/cache', () => ({ revalidatePath: (...args: readonly unknown[]) => spies.revalidatePath(...args) }))
vi.mock('../lib/script/server', async (actual) => ({ ...(await actual<Record<string, unknown>>()), rederiveProject: () => Promise.resolve({ ok: true, derivation: null }) }))

const { proposalSink } = await import('../lib/agent/proposer')
const { defineExecutor, registerExecutors } = await import('../lib/agent/executors')
const { setAssistantAutonomy } = await import('../lib/settings/actions')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const ME = '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b'

const gate = {
  actor: ME as never,
  scope: {} as ProjectScope<'transaction'>,
  project: { id: PROJECT } as Project,
  episode: EPISODE,
  role: 'writer' as const,
}

beforeAll(() => {
  registerExecutors([
    defineExecutor({
      tool: 'test_record',
      args: z.object({ name: z.string() }),
      minimumRole: 'writer',
      describe: (args) => `Update ${args.name}`,
      target: () => ({ type: 'record', id: null }),
      capture: () => Promise.resolve({}),
      run: (_ctx, args) => {
        spies.ran.push(args.name)
        return Promise.resolve({ ok: true, result: {} })
      },
    }),
  ])
})

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  spies.ran.length = 0
  spies.db.snapshotVersion?.mockResolvedValue({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
  spies.db.logAgentActivity?.mockResolvedValue(undefined)
})

const op = (mode: ProposedOp['mode'], base?: ProposalDocumentBase): ProposedOp => ({ tool: 'test_record', args: { name: 'MEERA' }, mode, description: 'Update MEERA', base })
const group = (entries: readonly ProposedOp[]) => ({ ops: entries.map((entry, index) => ({ key: `toolu_${String(Math.random())}_${String(index)}`, op: entry })) })

describe('the sink under each autonomy', () => {
  it('review: the proposal waits for the writer', async () => {
    const [made] = await proposalSink(gate, RUN, 'review').create([group([op('propose')])])
    expect(made).toMatchObject({ auto: false, needsConfirmation: false })
    expect(made?.applied).toBeUndefined()
    expect(spies.ran).toEqual([])
    expect(store.get(made?.proposalId ?? '')?.proposal.status).toBe('pending')
  })

  it('auto: a proposal of records only applies in the turn', async () => {
    const [made] = await proposalSink(gate, RUN, 'auto').create([group([op('propose')])])
    expect(made).toMatchObject({ applied: true, auto: false })
    expect(spies.ran).toEqual(['MEERA'])
    expect(store.get(made?.proposalId ?? '')?.proposal.status).toBe('applied')
  })

  it('auto: a script edit goes back to the panel to apply, so the open editor writes it (D10)', async () => {
    const base = { documentId: documentId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'), kind: 'screenplay' as const, episodeId: EPISODE.id, digest: 'x' }
    const [made] = await proposalSink(gate, RUN, 'auto').create([group([op('propose', base)])])
    expect(made).toMatchObject({ auto: true })
    expect(spies.ran).toEqual([])
  })

  it('auto never applies what must be confirmed - confirm and paid always stop for a click (D1)', async () => {
    const made = await proposalSink(gate, RUN, 'auto').create([group([op('confirm')]), group([op('paid')])])
    expect(made.map((entry) => [entry.auto, entry.needsConfirmation, entry.applied])).toEqual([
      [false, true, undefined],
      [false, true, undefined],
    ])
    expect(spies.ran).toEqual([])
  })
})

describe('the setting', () => {
  it('writes the signed-in person`s own row, and nobody else`s', async () => {
    spies.requireUser.mockResolvedValue({ id: ME })
    spies.db.transactionDatabase?.mockResolvedValue({ db: true })
    expect(await setAssistantAutonomy('auto')).toEqual({ status: 'saved', autonomy: 'auto' })
    expect(spies.db.setAgentAutonomy).toHaveBeenCalledWith({ db: true }, ME, 'auto')
  })

  it('refuses a value that is not review or auto', async () => {
    spies.requireUser.mockResolvedValue({ id: ME })
    expect(await setAssistantAutonomy('yolo')).toEqual({ status: 'error', message: 'Choose review or automatic.' })
    expect(spies.db.setAgentAutonomy).not.toHaveBeenCalled()
  })
})

describe('a direct operation answered twice (roadmap task 4.4)', () => {
  it('runs once: a replayed call - a resumed background run`s - gets the first answer back, not a second run', async () => {
    const sink = proposalSink(gate, RUN, 'review')
    const op: ProposedOp = { tool: 'test_record', args: { name: 'MEERA' }, mode: 'direct', description: 'Update MEERA' }
    const first = await sink.applyNow(op, 'toolu_direct')
    const again = await sink.applyNow(op, 'toolu_direct')
    expect(first.ok).toBe(true)
    expect(again).toEqual(first)
    expect(spies.ran).toEqual(['MEERA'])
  })
})
