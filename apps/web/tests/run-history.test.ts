// @vitest-environment node
import type { AgentProposalWithOps, AgentRun, Episode, Project } from '@folio/contracts'
import { agentProposalId, agentProposalOpId, assistantChatId, assistantMessageId, episodeId, episodeSlug, projectId, userId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { runId } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The panel's run history - roadmap task 5.4. Read from `agent_runs`,
 * `agent_proposals` / their operations and `activity_log`: each run's title
 * (a background run's own, a turn's first line), its tokens and credits, each
 * operation in its executor's words with where it stands and when it was
 * undone, a link to what it changed - a created record's own page - and
 * whether Undo run would do anything.
 */

const spies = vi.hoisted(() => ({ db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>> }))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['listRunsWithInput', 'listProposalsForRuns', 'listRunActivity', 'readMessageBodies', 'listEpisodes', 'listSceneIndex']
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})

const { readRunHistoryWith, placeOf } = await import('../lib/agent/history')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const gate = { actor: userId('7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b'), scope: {} as ProjectScope, project: { id: PROJECT, projectType: 'series' } as Project, role: 'writer' as const }

const TURN = runId('0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21')
const STORY = runId('1b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21')
const MEERA = 'c0000000-0000-4000-8000-000000000001'

const run = (id: typeof TURN, over: Partial<AgentRun>): AgentRun => ({
  id,
  projectId: PROJECT,
  episodeId: EPISODE.id,
  chatId: assistantChatId('5f4e3d2c-1b0a-4987-8654-3210fedcba98'),
  messageId: null,
  createdBy: gate.actor,
  status: 'succeeded',
  mode: 'interactive',
  inputTokens: 0,
  outputTokens: 0,
  creditBudget: 0,
  creditsSpent: 0,
  error: null,
  createdAt: '2026-09-24T09:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  ...over,
})

const proposal = (n: number, run: typeof TURN, ops: readonly { tool: string; args: unknown; status: 'applied' | 'undone' | 'pending'; result?: unknown; undo?: unknown; key?: string }[]): AgentProposalWithOps => {
  const id = agentProposalId(`a0000000-0000-4000-8000-00000000000${String(n)}`)
  return {
    proposal: { id, projectId: PROJECT, runId: run, episodeId: EPISODE.id, status: 'applied', summary: 'A proposal', base: { documents: [] }, needsConfirmation: false, creditCost: null, decidedBy: null, decidedAt: null, createdAt: '', updatedAt: '' },
    ops: ops.map((op, seq) => ({
      id: agentProposalOpId(`b0000000-0000-4000-8000-0000000000${String(n)}${String(seq)}`),
      projectId: PROJECT,
      proposalId: id,
      seq,
      tool: op.tool,
      args: op.args,
      mode: 'propose',
      idempotencyKey: op.key ?? `toolu_${String(n)}${String(seq)}`,
      status: op.status,
      result: op.result ?? null,
      undo: op.undo ?? null,
      appliedAt: op.status === 'pending' ? null : '2026-09-24T09:01:00.000Z',
      createdAt: '',
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  spies.db['listEpisodes']?.mockResolvedValue([EPISODE])
  spies.db['listSceneIndex']?.mockResolvedValue([])
  spies.db['listRunActivity']?.mockResolvedValue([])
  spies.db['readMessageBodies']?.mockResolvedValue(new Map([['c1000000-0000-4000-8000-000000000001', 'Add Meera to the cast\nand give her a bio']]))
})

describe('readRunHistoryWith', () => {
  it('titles each run, carries its tokens and credits, and words each operation as its executor does', async () => {
    spies.db['listRunsWithInput']?.mockResolvedValue([
      { run: run(TURN, { messageId: assistantMessageId('c1000000-0000-4000-8000-000000000001'), inputTokens: 9_000, outputTokens: 1_400 }), input: null },
      { run: run(STORY, { mode: 'background', status: 'waiting_for_user', creditBudget: 415, creditsSpent: 40 }), input: { kind: 'story_to_script', title: 'The Last Ferry', story: 'A ferry.' } },
    ])
    spies.db['listProposalsForRuns']?.mockResolvedValue([proposal(1, TURN, [{ tool: 'create_character', args: { name: 'MEERA' }, status: 'applied', result: { id: MEERA }, undo: { id: MEERA } }])])
    const [turn, story] = await readRunHistoryWith(gate)
    expect(turn).toMatchObject({ title: 'Add Meera to the cast', kind: 'turn', tokens: { input: 9_000, output: 1_400 }, credits: { budget: 0, spent: 0 }, undoable: true })
    expect(turn?.proposals[0]?.ops[0]).toMatchObject({ tool: 'create_character', description: 'Create the character MEERA', status: 'applied', undoneAt: null })
    // A create's target names no record until it runs; its result does, and the link opens that record.
    expect(turn?.proposals[0]?.ops[0]?.open).toEqual({ kind: 'record', projectId: PROJECT, entity: 'character', id: MEERA })
    expect(story).toMatchObject({ title: 'The Last Ferry', kind: 'story_to_script', status: 'waiting_for_user', credits: { budget: 415, spent: 40 }, proposals: [], undoable: false })
  })

  it('says when undo put an operation back, and offers Undo run only while something can still be put back', async () => {
    spies.db['listRunsWithInput']?.mockResolvedValue([{ run: run(TURN, {}), input: null }])
    spies.db['listProposalsForRuns']?.mockResolvedValue([
      proposal(1, TURN, [
        { tool: 'create_character', args: { name: 'MEERA' }, status: 'undone', result: { id: MEERA }, undo: { id: MEERA } },
        // The undo's own inverse operations never make a run undoable again.
        { tool: 'create_character', args: { name: 'ARJUN' }, status: 'applied', undo: { id: MEERA }, key: 'undo:b1:0' },
      ]),
    ])
    spies.db['listRunActivity']?.mockResolvedValue([{ runId: TURN, opId: 'b0000000-0000-4000-8000-000000000010', verb: 'agent:undo_run', targetType: 'character', targetId: null, at: '2026-09-24T10:00:00.000Z' }])
    const [turn] = await readRunHistoryWith(gate)
    expect(turn?.proposals[0]?.ops[0]).toMatchObject({ status: 'undone', undoneAt: '2026-09-24T10:00:00.000Z' })
    expect(turn?.undoable).toBe(false)
    expect(turn?.title).toBe('A turn')
  })

  it('reads nothing past the runs when there are none', async () => {
    spies.db['listRunsWithInput']?.mockResolvedValue([])
    expect(await readRunHistoryWith(gate)).toEqual([])
    expect(spies.db['listProposalsForRuns']).not.toHaveBeenCalled()
  })
})

describe('placeOf', () => {
  it('opens a record on its page, a scene in the script, production work in Production, and nothing for a run', () => {
    expect(placeOf({ type: 'location', id: 'l1' }, 1)).toEqual({ route: 'locations', recordId: 'l1' })
    expect(placeOf({ type: 'scene', id: 's1' }, 1)).toEqual({ route: 'script', sceneId: 's1' })
    expect(placeOf({ type: 'reel_shot', id: null }, 2)).toEqual({ route: 'production', episode: 2 })
    expect(placeOf({ type: 'story_thread', id: 't1' }, 2)).toEqual({ route: 'timeline' })
    expect(placeOf({ type: 'agent_run', id: null }, 1)).toBeNull()
  })
})
