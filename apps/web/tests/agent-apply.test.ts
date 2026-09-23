// @vitest-environment node
import type { AgentProposal, AgentProposalOp, AgentProposalWithOps, Episode, Project } from '@folio/contracts'
import { agentProposalId, agentProposalOpId, episodeId, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { documentId, runId } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * Apply and undo - roadmap task 3.2, ADR 0003 **D1**, **D10**, **D11**.
 *
 * The proposal tables are an in-memory store here, so each assertion reads
 * what `apply.ts` actually wrote - the order of the writes included, because
 * "the undo record is stored before the operation runs" is a claim about
 * order. The executors are test ones over a small record store, so a failure
 * can be put exactly where the test needs it.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  rederive: vi.fn(),
  writes: [] as string[],
}))

type Row = { proposal: AgentProposal; ops: AgentProposalOp[] }
const store = new Map<string, Row>()
const copy = (row: Row): AgentProposalWithOps => structuredClone({ proposal: row.proposal, ops: row.ops })

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['readDocumentById', 'readScreenplayNodes', 'readOutlineNodes', 'snapshotVersion', 'logAgentActivity']
  for (const name of names) spies.db[name] = vi.fn()
  const fake = {
    readProposal: (_scope: unknown, id: string) => Promise.resolve(store.has(id) ? copy(store.get(id) as Row) : null),
    listRunProposals: (_scope: unknown, run: string) =>
      Promise.resolve([...store.values()].filter((row) => row.proposal.runId === run).map(copy)),
    claimProposal: (_scope: unknown, id: string, actor: string) => {
      const row = store.get(id)
      if (row === undefined || row.proposal.status !== 'pending' || row.proposal.decidedAt !== null) return Promise.resolve(false)
      row.proposal = { ...row.proposal, decidedAt: '2026-09-23T10:00:00.000Z', decidedBy: actor as AgentProposal['decidedBy'] }
      spies.writes.push('claim')
      return Promise.resolve(true)
    },
    settleProposal: (_scope: unknown, id: string, status: AgentProposal['status']) => {
      const row = store.get(id)
      if (row !== undefined) row.proposal = { ...row.proposal, status }
      spies.writes.push(`settle:${status}`)
      return Promise.resolve()
    },
    releaseProposal: () => Promise.resolve(),
    markProposalOp: (_scope: unknown, id: string, mark: { status: AgentProposalOp['status']; result?: unknown; undo?: unknown }) => {
      for (const row of store.values()) {
        row.ops = row.ops.map((op) =>
          op.id === id
            ? { ...op, status: mark.status, ...(mark.result === undefined ? {} : { result: mark.result }), ...(mark.undo === undefined ? {} : { undo: mark.undo }) }
            : op,
        )
      }
      spies.writes.push(`mark:${mark.status}${mark.undo === undefined ? '' : '+undo'}`)
      return Promise.resolve()
    },
    skipPendingOps: (_scope: unknown, id: string) => {
      const row = store.get(id)
      if (row !== undefined) row.ops = row.ops.map((op) => (op.status === 'pending' ? { ...op, status: 'skipped' } : op))
      return Promise.resolve()
    },
    createProposal: (_scope: unknown, input: { runId: string; episodeId: string; summary: string; base: AgentProposal['base']; needsConfirmation: boolean; ops: { tool: string; args: unknown; mode: AgentProposalOp['mode']; idempotencyKey: string }[] }) => {
      const id = `00000000-0000-4000-8000-${String(store.size + 1).padStart(12, '0')}`
      const row: Row = {
        proposal: proposalRow(id, { runId: runId(input.runId), summary: input.summary, base: input.base, needsConfirmation: input.needsConfirmation }),
        ops: input.ops.map((op, seq) => opRow(`${id.slice(0, -2)}${String(seq).padStart(2, '0')}`.replace(/^0/, '1'), id, seq, op.tool, op.args, op.mode, op.idempotencyKey)),
      }
      store.set(id, row)
      return Promise.resolve(copy(row))
    },
  }
  return {
    ...real,
    ...fake,
    ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])),
  }
})

vi.mock('../lib/script/server', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  rederiveProject: (...args: readonly unknown[]) => spies.rederive(...args),
}))

const { applyProposalWith, undoRunWith } = await import('../lib/agent/apply')
const { defineExecutor, registerExecutors } = await import('../lib/agent/executors')
const { requestRederive } = await import('../lib/script/derive-batch')
const { nodeDigest } = await import('../lib/script/server')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a')
const RUN = runId('0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21')
const DOCUMENT = documentId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d')
const ME = '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b'

const gate = (role: 'reader' | 'writer' | 'owner' = 'writer') => ({
  actor: ME as never,
  scope: {} as ProjectScope<'transaction'>,
  project: { id: PROJECT } as Project,
  episode: { id: EPISODE, ordinal: 1 } as Episode,
  role,
})

function proposalRow(id: string, over: Partial<AgentProposal> = {}): AgentProposal {
  return {
    id: agentProposalId(id),
    projectId: PROJECT,
    runId: RUN,
    episodeId: EPISODE,
    status: 'pending',
    summary: 'Test proposal',
    base: { documents: [] },
    needsConfirmation: false,
    creditCost: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-09-23T09:00:00.000Z',
    updatedAt: '2026-09-23T09:00:00.000Z',
    ...over,
  }
}

function opRow(id: string, proposal: string, seq: number, tool: string, args: unknown, mode: AgentProposalOp['mode'] = 'propose', key = `toolu_${id}`): AgentProposalOp {
  return { id: agentProposalOpId(id), projectId: PROJECT, proposalId: agentProposalId(proposal), seq, tool, args, mode, idempotencyKey: key, status: 'pending', result: null, undo: null, appliedAt: null }
}

/** A tiny record store the test executors write: `name -> value`. */
const records = new Map<string, string>()
const calls: string[] = []

const SetArgs = z.object({ name: z.string(), value: z.string() })

beforeAll(() => {
  registerExecutors([
    defineExecutor({
      tool: 'test_set',
      args: SetArgs,
      minimumRole: 'writer',
      describe: (args) => `Set ${args.name} to ${args.value}`,
      target: () => ({ type: 'record', id: null }),
      capture: (_ctx, args) => {
        calls.push(`capture:${args.name}`)
        return Promise.resolve({ name: args.name, before: records.get(args.name) ?? null, after: args.value })
      },
      run: async (ctx, args) => {
        calls.push(`run:${args.name}`)
        await requestRederive(ctx.gate.scope)
        records.set(args.name, args.value)
        return { ok: true, result: { set: args.name } }
      },
      invert: (_ctx, args, undo) => {
        const record = z.object({ name: z.string(), before: z.string().nullable(), after: z.string() }).parse(undo)
        calls.push(`invert:${args.name}`)
        if (records.get(record.name) !== record.after) {
          return Promise.resolve({ kind: 'changed' as const, ops: [{ tool: 'test_set', args: { name: record.name, value: record.before ?? '' }, mode: 'propose' as const }], note: `${record.name} changed since the run` })
        }
        if (record.before === null) records.delete(record.name)
        else records.set(record.name, record.before)
        return Promise.resolve({ kind: 'undone' as const })
      },
    }),
    defineExecutor({
      tool: 'test_boom',
      args: z.object({}),
      minimumRole: 'writer',
      describe: () => 'Fail',
      target: () => ({ type: 'record', id: null }),
      capture: () => Promise.resolve(null),
      run: () => {
        calls.push('run:boom')
        return Promise.resolve({ ok: false, message: 'That record could not be saved.' })
      },
    }),
    defineExecutor({
      tool: 'test_merge',
      args: z.object({}),
      minimumRole: 'writer',
      describe: () => 'Merge two records',
      target: () => ({ type: 'record', id: null }),
      capture: () => Promise.resolve(null),
      run: () => {
        calls.push('run:merge')
        return Promise.resolve({ ok: true, result: { merged: true } })
      },
    }),
    defineExecutor({
      tool: 'test_comment',
      args: z.object({}),
      minimumRole: 'reader',
      describe: () => 'Comment',
      target: () => ({ type: 'thread', id: null }),
      capture: () => Promise.resolve(null),
      run: () => Promise.resolve({ ok: true, result: {} }),
    }),
  ])
})

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

const seed = (id: string, ops: readonly { tool: string; args: unknown; mode?: AgentProposalOp['mode'] }[], over: Partial<AgentProposal> = {}): void => {
  store.set(id, {
    proposal: proposalRow(id, over),
    ops: ops.map((op, seq) => opRow(`${id.slice(0, 34)}${String(seq).padStart(2, '0')}`, id, seq, op.tool, op.args, op.mode ?? 'propose')),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  records.clear()
  calls.length = 0
  spies.writes.length = 0
  spies.rederive.mockResolvedValue({ ok: true, derivation: null })
  spies.db.snapshotVersion?.mockResolvedValue({})
  spies.db.logAgentActivity?.mockResolvedValue(undefined)
})

describe('applyProposalWith', () => {
  it('runs every operation in order and settles applied', async () => {
    seed(P1, [
      { tool: 'test_set', args: { name: 'a', value: '1' } },
      { tool: 'test_set', args: { name: 'b', value: '2' } },
    ])
    const outcome = await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect(outcome.status).toBe('applied')
    expect(calls).toEqual(['capture:a', 'run:a', 'capture:b', 'run:b'])
    expect(records.get('a')).toBe('1')
    expect(store.get(P1)?.ops.map((op) => op.status)).toEqual(['applied', 'applied'])
  })

  it('stores the undo record before the operation runs, then the result after', async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }])
    records.set('a', '0')
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect(spies.writes).toEqual(['claim', 'mark:pending+undo', 'mark:applied+undo', 'settle:applied'])
    expect(store.get(P1)?.ops[0]?.undo).toEqual({ name: 'a', before: '0', after: '1' })
  })

  it('writes one activity row per operation, with the verb agent:<tool> and the run', async () => {
    seed(P1, [
      { tool: 'test_set', args: { name: 'a', value: '1' } },
      { tool: 'test_merge', args: {} },
    ])
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    const verbs = spies.db.logAgentActivity?.mock.calls.map((call) => (call[1] as { verb: string }).verb)
    expect(verbs).toEqual(['agent:test_set', 'agent:test_merge'])
    expect((spies.db.logAgentActivity?.mock.calls[0]?.[1] as { diff: { runId: string } }).diff.runId).toBe(RUN)
  })

  it('stops at a failure midway: the prefix is applied, the rest skipped, the proposal partially applied', async () => {
    seed(P1, [
      { tool: 'test_set', args: { name: 'a', value: '1' } },
      { tool: 'test_boom', args: {} },
      { tool: 'test_set', args: { name: 'b', value: '2' } },
    ])
    const outcome = await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect(outcome.status).toBe('partially_applied')
    expect(outcome.status !== 'refused' && 'failure' in outcome ? outcome.failure : null).toBe('That record could not be saved.')
    expect(store.get(P1)?.ops.map((op) => op.status)).toEqual(['applied', 'failed', 'skipped'])
    expect(records.has('b')).toBe(false)
    expect(calls).not.toContain('run:b')
  })

  it('is failed, not partially applied, when the first operation fails', async () => {
    seed(P1, [
      { tool: 'test_boom', args: {} },
      { tool: 'test_set', args: { name: 'a', value: '1' } },
    ])
    const outcome = await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect(outcome.status).toBe('failed')
    expect(records.size).toBe(0)
  })

  it('asks for confirmation for a confirm-mode operation, whatever the autonomy, and claims nothing (D1)', async () => {
    seed(P1, [{ tool: 'test_merge', args: {}, mode: 'confirm' }], { needsConfirmation: true })
    const outcome = await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect(outcome.status).toBe('needs-confirmation')
    expect(spies.writes).toEqual([])
    expect((await applyProposalWith(gate(), agentProposalId(P1), { confirmed: true })).status).toBe('applied')
  })

  it("refuses a reader a writer's operation with the gate's words, and lets them apply a comment (D2)", async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }])
    const refused = await applyProposalWith(gate('reader'), agentProposalId(P1), { confirmed: false })
    expect(refused).toEqual({ status: 'refused', message: "Your role on this project doesn't allow that." })
    seed(P2, [{ tool: 'test_comment', args: {} }])
    expect((await applyProposalWith(gate('reader'), agentProposalId(P2), { confirmed: false })).status).toBe('applied')
  })

  it('applies once when clicked twice', async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }])
    const [first, second] = await Promise.all([
      applyProposalWith(gate(), agentProposalId(P1), { confirmed: false }),
      applyProposalWith(gate(), agentProposalId(P1), { confirmed: false }),
    ])
    expect([first.status, second.status].sort()).toEqual(['applied', 'decided'])
    expect(calls.filter((call) => call === 'run:a')).toHaveLength(1)
  })

  it('is stale, and runs nothing, when a document it was planned against has changed (D10)', async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }], {
      base: { documents: [{ documentId: DOCUMENT, kind: 'screenplay', episodeId: EPISODE, digest: nodeDigest([]) }] },
    })
    spies.db.readDocumentById?.mockResolvedValue({ id: DOCUMENT, kind: 'screenplay', episodeId: EPISODE, updatedAt: '2026-09-23T09:30:00.000Z' })
    spies.db.readScreenplayNodes?.mockResolvedValue({ ok: true, value: [{ node: { id: 'n', type: 'action' }, orderKey: 'a0' }] })
    const outcome = await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect(outcome.status).toBe('stale')
    expect(calls).toEqual([])
    expect(spies.db.snapshotVersion).not.toHaveBeenCalled()
  })

  it('snapshots each base document before_agent_run, carrying the run id, before anything runs (D11)', async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }], {
      base: { documents: [{ documentId: DOCUMENT, kind: 'screenplay', episodeId: EPISODE, digest: nodeDigest([]) }] },
    })
    spies.db.readDocumentById?.mockResolvedValue({ id: DOCUMENT, kind: 'screenplay', episodeId: EPISODE, updatedAt: '2026-09-23T09:30:00.000Z' })
    spies.db.readScreenplayNodes?.mockResolvedValue({ ok: true, value: [] })
    spies.db.snapshotVersion?.mockImplementation(() => {
      calls.push('snapshot')
      return Promise.resolve({})
    })
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect(calls[0]).toBe('snapshot')
    expect(spies.db.snapshotVersion?.mock.calls[0]?.slice(1)).toEqual([DOCUMENT, 'before_agent_run', [], 0, RUN])
  })

  it('re-derives once at the end, however many operations asked (task 1.5)', async () => {
    seed(P1, [
      { tool: 'test_set', args: { name: 'a', value: '1' } },
      { tool: 'test_set', args: { name: 'b', value: '2' } },
      { tool: 'test_set', args: { name: 'c', value: '3' } },
    ])
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect(spies.rederive).toHaveBeenCalledTimes(1)
  })

  it('refuses a proposal that has already been decided', async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }], { status: 'rejected' })
    expect((await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })).status).toBe('decided')
  })
})

describe('undoRunWith', () => {
  it("reverses the run's applied operations newest first, across proposals", async () => {
    seed(P1, [
      { tool: 'test_set', args: { name: 'a', value: '1' } },
      { tool: 'test_set', args: { name: 'b', value: '2' } },
    ])
    seed(P2, [{ tool: 'test_set', args: { name: 'c', value: '3' } }], { createdAt: '2026-09-23T09:05:00.000Z' })
    records.set('a', '0')
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    await applyProposalWith(gate(), agentProposalId(P2), { confirmed: false })
    calls.length = 0

    const outcome = await undoRunWith(gate(), RUN)
    expect(outcome.status).toBe('undone')
    expect(calls).toEqual(['invert:c', 'invert:b', 'invert:a'])
    expect([...records.entries()]).toEqual([['a', '0']])
    expect(store.get(P1)?.ops.map((op) => op.status)).toEqual(['undone', 'undone'])
    const verbs = spies.db.logAgentActivity?.mock.calls.map((call) => (call[1] as { verb: string }).verb)
    expect(verbs?.filter((verb) => verb === 'agent:undo_run')).toHaveLength(3)
  })

  it('names what cannot be undone and leaves it, and never re-runs what the proposal skipped', async () => {
    seed(P1, [
      { tool: 'test_set', args: { name: 'a', value: '1' } },
      { tool: 'test_merge', args: {} },
      { tool: 'test_boom', args: {} },
      { tool: 'test_set', args: { name: 'b', value: '2' } },
    ])
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    calls.length = 0
    const outcome = await undoRunWith(gate(), RUN)
    if (outcome.status === 'refused') throw new Error(outcome.message)
    expect(outcome.undone).toBe(1)
    expect(outcome.skipped).toEqual([{ tool: 'test_merge', description: 'Merge two records', reason: 'This cannot be undone.' }])
    expect(calls).toEqual(['invert:a'])
  })

  it('does not overwrite a record changed since the run: it proposes putting it back instead', async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }])
    records.set('a', '0')
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    records.set('a', 'typed by the writer')

    const outcome = await undoRunWith(gate(), RUN)
    if (outcome.status === 'refused') throw new Error(outcome.message)
    expect(outcome.status).toBe('partly-undone')
    expect(records.get('a')).toBe('typed by the writer')
    expect(outcome.proposal?.proposal.status).toBe('pending')
    expect(outcome.proposal?.ops.map((op) => [op.tool, op.args, op.idempotencyKey.startsWith('undo:')])).toEqual([['test_set', { name: 'a', value: '0' }, true]])
    expect(outcome.notes).toEqual(['a changed since the run'])
  })

  it("never reverses undo's own proposal on a second undo", async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }])
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    records.set('a', 'moved')
    const first = await undoRunWith(gate(), RUN)
    if (first.status === 'refused' || first.proposal === null) throw new Error('expected a proposal')
    records.set('a', '0')
    await applyProposalWith(gate(), first.proposal.proposal.id, { confirmed: false })
    calls.length = 0
    const second = await undoRunWith(gate(), RUN)
    expect(calls.filter((call) => call.startsWith('invert'))).toEqual(['invert:a'])
    expect(second.status).not.toBe('refused')
  })

  it("refuses a reader the undo of a writer's run", async () => {
    seed(P1, [{ tool: 'test_set', args: { name: 'a', value: '1' } }])
    await applyProposalWith(gate(), agentProposalId(P1), { confirmed: false })
    expect((await undoRunWith(gate('reader'), RUN)).status).toBe('refused')
  })
})
