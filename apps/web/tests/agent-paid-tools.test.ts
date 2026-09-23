// @vitest-environment node
import type { AgentProposal, AgentProposalOp, Episode, Project } from '@folio/contracts'
import { GENERATION_COSTS, agentProposalId, agentProposalOpId, episodeId, episodeSlug, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { runId } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { member, reel, scene, sheetDone, uid } from './helpers/production-fixtures'

/**
 * The paid tools and the run's credit budget - roadmap task 5.1, ADR 0003
 * **D1** and **D3**.
 *
 *   - A paid call is priced when it is made and proposes with its price; the
 *     proposal carries the sum, and a call that cannot name its price is
 *     refused.
 *   - Confirming a paid proposal - and only confirming it - grants the run
 *     exactly that budget, once.
 *   - Each image or shoot spends from the grant before it starts: past the
 *     grant nothing starts and no core is called; what did not start is given
 *     back; a short balance stops the rest.
 *
 * The cores and the database are mocked; the registry, the executors and
 * `apply.ts` are the real ones.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  core: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  proposal: null as { proposal: AgentProposal; ops: AgentProposalOp[] } | null,
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['grantRunBudget', 'spendRunBudget', 'returnRunBudget', 'listLiveGenerations', 'listLocationRecords', 'logAgentActivity', 'snapshotVersion', 'createProposal', 'readProposalOpByKey', 'markProposalOp', 'settleProposal', 'skipPendingOps']
  for (const name of names) spies.db[name] = vi.fn()
  return {
    ...real,
    ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])),
    readProposal: () => Promise.resolve(spies.proposal === null ? null : structuredClone(spies.proposal)),
    claimProposal: () => {
      const held = spies.proposal
      if (held === null || held.proposal.decidedAt !== null) return Promise.resolve(false)
      held.proposal = { ...held.proposal, decidedAt: '2026-09-24T10:00:00.000Z' }
      return Promise.resolve(true)
    },
  }
})

vi.mock('../lib/production/generate-core', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['ground', 'generateSheetWith', 'generateSceneImageWith', 'generateFramesEachWith', 'generateLocationPlateWith', 'shootReelWith']
  for (const name of names) spies.core[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.core[name]?.(...args)])) }
})

vi.mock('../lib/production/pipeline/connection', () => ({ connected: () => null }))

const { applyProposalWith } = await import('../lib/agent/apply')
const { defineWriteTool } = await import('../lib/agent/write-tool')
const { costOf } = await import('../lib/agent/proposer')
const { registerExecutors } = await import('../lib/agent/executors')
const { generateImagesTool, shootReelTool } = await import('../lib/agent/tools/writes-paid')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const RUN = runId('0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21')

const gate = () => ({ actor: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b' as never, scope: {} as ProjectScope<'transaction'>, project: { id: PROJECT } as Project, episode: EPISODE, role: 'writer' as const })

const queued = (n: number) => ({ status: 'queued' as const, generation: { id: uid('gen', n) } })

/** What a tool call proposed, and a context that records it. */
const toolContext = () => {
  const proposed: { tool: string; args: unknown; mode: string; cost?: number | undefined }[] = []
  const ctx = {
    gate: gate(),
    runId: RUN,
    idempotencyKey: 'toolu_1',
    emit: vi.fn(),
    loaded: new Set<never>(),
    proposals: { propose: (op: (typeof proposed)[number]) => void proposed.push(op), earlier: () => undefined, applyNow: vi.fn() },
  }
  return { ctx, proposed }
}

const execContext = () => ({ gate: gate(), runId: RUN, proposalId: agentProposalId(uid('gen', 99)), idempotencyKey: 'k', digests: new Map(), snapshots: new Map(), editorDocuments: new Set(), schedule: () => undefined }) as never

beforeEach(() => {
  vi.clearAllMocks()
  spies.proposal = null
  spies.db['spendRunBudget']?.mockResolvedValue(true)
  spies.db['listLiveGenerations']?.mockResolvedValue([])
  spies.db['listLocationRecords']?.mockResolvedValue([
    { id: uid('location', 1), name: 'Jetty', description: 'A timber jetty at low tide.', address: null, photoKey: null },
    { id: uid('location', 2), name: 'Ferry deck', description: null, address: null, photoKey: 'projects/p/locations/2/photo.png' },
  ])
})

// ---------------------------------------------------------------------------

describe('a paid write tool', () => {
  const Args = z.object({ n: z.int() })
  const priced = (cost: number | undefined) =>
    defineWriteTool({
      name: 'paid_probe',
      description: 'A probe.',
      toolset: 'production',
      minimumRole: 'writer',
      mode: 'paid',
      input: Args,
      label: () => 'Probing',
      prepare: (_ctx, input) => Promise.resolve({ ok: true as const, args: input, ...(cost === undefined ? {} : { cost }) }),
      executor: { args: Args, describe: (args) => `Probe ${String(args.n)}`, target: () => ({ type: 'probe', id: null }), capture: () => Promise.resolve(null), run: () => Promise.resolve({ ok: true, result: null }) },
    })

  it('proposes with its price and tells the model the writer confirms the cost', async () => {
    const { ctx, proposed } = toolContext()
    const result = await priced(80).tool.run(ctx as never, { n: 1 })
    expect(proposed).toEqual([expect.objectContaining({ tool: 'paid_probe', mode: 'paid', cost: 80 })])
    expect(result).toMatchObject({ ok: true, content: { credits: 80, status: 'The writer must confirm this and its cost before anything is spent.' } })
  })

  it('is refused when it cannot name its price - nothing is proposed', async () => {
    const { ctx, proposed } = toolContext()
    expect(await priced(undefined).tool.run(ctx as never, { n: 1 })).toEqual({ ok: false, message: 'paid_probe could not name its cost.' })
    expect(proposed).toEqual([])
  })

  it('sums a group`s paid operations into the proposal`s cost, and a group with none costs nothing', () => {
    const op = (mode: 'paid' | 'propose', cost?: number) => ({ key: 'k', op: { tool: 't', args: {}, mode, description: 'd', cost } })
    expect(costOf({ ops: [op('paid', 40), op('paid', 375)] })).toBe(415)
    expect(costOf({ ops: [op('propose')] })).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('the run`s budget is granted by the confirmation (D3)', () => {
  registerExecutors([
    defineWriteTool({
      name: 'grant_probe',
      description: 'A probe.',
      toolset: 'production',
      minimumRole: 'writer',
      mode: 'paid',
      input: z.object({}),
      label: () => 'Probing',
      prepare: () => Promise.resolve({ ok: true as const, args: {}, cost: 120 }),
      executor: { args: z.object({}), describe: () => 'Probe', target: () => ({ type: 'probe', id: null }), capture: () => Promise.resolve(null), run: () => Promise.resolve({ ok: true, result: null }) },
    }).executor,
  ])

  beforeEach(() => {
    spies.proposal = {
      proposal: {
        id: agentProposalId(uid('gen', 50)),
        projectId: PROJECT,
        runId: RUN,
        episodeId: EPISODE.id,
        status: 'pending',
        summary: 'Probe',
        base: { documents: [] },
        needsConfirmation: true,
        creditCost: 120,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-09-24T09:00:00.000Z',
        updatedAt: '2026-09-24T09:00:00.000Z',
      },
      ops: [{ id: agentProposalOpId(uid('gen', 51)), proposalId: agentProposalId(uid('gen', 50)), seq: 0, tool: 'grant_probe', args: {}, mode: 'paid', idempotencyKey: 'toolu_g', status: 'pending', result: null, undo: null, appliedAt: null } as AgentProposalOp],
    }
  })

  it('grants nothing without the writer`s confirmation', async () => {
    expect((await applyProposalWith(gate(), agentProposalId(uid('gen', 50)), { confirmed: false })).status).toBe('needs-confirmation')
    expect(spies.db['grantRunBudget']).not.toHaveBeenCalled()
  })

  it('grants exactly the confirmed cost to the proposal`s run, once - a second click decides nothing', async () => {
    expect((await applyProposalWith(gate(), agentProposalId(uid('gen', 50)), { confirmed: true })).status).toBe('applied')
    expect(spies.db['grantRunBudget']).toHaveBeenCalledTimes(1)
    expect(spies.db['grantRunBudget']).toHaveBeenCalledWith(expect.anything(), RUN, 120)
    expect((await applyProposalWith(gate(), agentProposalId(uid('gen', 50)), { confirmed: true })).status).toBe('decided')
    expect(spies.db['grantRunBudget']).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------

describe('generate_images', () => {
  const scenes = [scene(1, [reel(1, 1, { sheet: null })], { stillState: 'empty' })]

  beforeEach(() => {
    spies.core['ground']?.mockResolvedValue({ gate: gate(), scenes, settings: { lockedAt: null }, artStyle: { name: 'Prestige' }, names: [] })
  })

  it('prices every image it names from GENERATION_COSTS, as one paid operation', async () => {
    const { ctx, proposed } = toolContext()
    const result = await generateImagesTool.tool.run(ctx as never, {
      images: [
        { kind: 'frames', shotIds: [uid('shot', 11), uid('shot', 12)] },
        { kind: 'plate', locationId: uid('location', 1) },
        { kind: 'sheet', reelId: uid('reel', 1) },
      ],
    })
    expect(result.ok).toBe(true)
    expect(proposed).toHaveLength(1)
    const [op] = proposed
    expect(op?.cost).toBe(GENERATION_COSTS.location_plate + GENERATION_COSTS.storyboard_sheet + 2 * GENERATION_COSTS.shot_frame)
    // Drawn in order: the plate before the sheet and the frames it is the set of.
    expect((op?.args as { items: { kind: string }[] }).items.map((item) => item.kind)).toEqual(['plate', 'sheet', 'frames'])
  })

  it('refuses a plate for a location that has a photo, and proposes nothing', async () => {
    const { ctx, proposed } = toolContext()
    const result = await generateImagesTool.tool.run(ctx as never, { images: [{ kind: 'plate', locationId: uid('location', 2) }] })
    expect(result).toEqual({ ok: false, message: 'Some of these cannot be drawn: Ferry deck already has a photo - that is its plate.' })
    expect(proposed).toEqual([])
  })

  const items = [
    { kind: 'plate' as const, locationId: uid('location', 1), label: 'The plate for Jetty', cost: 40 },
    { kind: 'frames' as const, reelId: uid('reel', 1), shotIds: [uid('shot', 11), uid('shot', 12), uid('shot', 13)], label: '3 frames for Reel 1, scene 1', cost: 12 },
  ]

  it('starts nothing past the confirmed budget - no core is called', async () => {
    spies.db['spendRunBudget']?.mockResolvedValue(false)
    const outcome = await generateImagesTool.executor.run(execContext(), { episode: 'ep_001', items }, null)
    expect(outcome).toEqual({ ok: false, message: 'It is past the credits you confirmed for this run.' })
    expect(spies.core['generateLocationPlateWith']).not.toHaveBeenCalled()
    expect(spies.core['generateFramesEachWith']).not.toHaveBeenCalled()
  })

  it('spends each image`s price before it starts, and gives back the share of frames that did not start', async () => {
    spies.core['generateLocationPlateWith']?.mockResolvedValue(queued(1))
    spies.core['generateFramesEachWith']?.mockResolvedValue([
      { shotId: uid('shot', 11), result: queued(2) },
      { shotId: uid('shot', 12), result: queued(3) },
    ])
    const outcome = await generateImagesTool.executor.run(execContext(), { episode: 'ep_001', items }, null)
    expect(spies.db['spendRunBudget']?.mock.calls.map((call) => call[2])).toEqual([40, 12])
    expect(spies.db['returnRunBudget']?.mock.calls.map((call) => call[2])).toEqual([4])
    expect(outcome).toEqual({
      ok: true,
      result: { started: ['The plate for Jetty', '3 frames for Reel 1, scene 1 (2 of 3)'], notStarted: [{ label: '3 frames for Reel 1, scene 1', reason: 'It could not start.' }], spent: 48 },
    })
  })

  it('stops the rest at a short balance, and gives its price back', async () => {
    spies.core['generateLocationPlateWith']?.mockResolvedValue({ status: 'insufficient', available: 10, cost: 40 })
    const outcome = await generateImagesTool.executor.run(execContext(), { episode: 'ep_001', items }, null)
    expect(outcome).toEqual({ ok: false, message: 'There are not enough credits: 40 credits needed, 10 credits available.' })
    expect(spies.core['generateFramesEachWith']).not.toHaveBeenCalled()
    expect(spies.db['returnRunBudget']).toHaveBeenCalledWith(expect.anything(), RUN, 40)
  })
})

// ---------------------------------------------------------------------------

describe('shoot_reel', () => {
  it('prices each ready reel at the reel price, says the first shoot locks the settings, and refuses one that is not ready', async () => {
    const ready = reel(1, 1, { sheet: sheetDone(1) })
    const noSheet = reel(2, 1)
    spies.core['ground']?.mockResolvedValue({ gate: gate(), scenes: [scene(1, [ready, noSheet], { cast: [member(1, 'MEERA')] })], settings: { lockedAt: null }, artStyle: { name: 'Prestige' }, names: [] })
    const { ctx, proposed } = toolContext()
    expect(await shootReelTool.tool.run(ctx as never, { reelIds: [uid('reel', 1)] })).toMatchObject({ ok: true })
    expect(proposed[0]).toMatchObject({ mode: 'paid', cost: GENERATION_COSTS.shoot_reel, args: { locks: true, reels: [{ reelId: uid('reel', 1), label: 'Reel 1, scene 1', cost: GENERATION_COSTS.shoot_reel }] } })
    expect(shootReelTool.executor.describe(proposed[0]?.args)).toBe('Shoot 1 reel for 375 credits: Reel 1, scene 1. The first shoot locks the episode settings')

    const refused = await shootReelTool.tool.run(toolContext().ctx as never, { reelIds: [uid('reel', 2)] })
    expect(refused).toEqual({ ok: false, message: 'Some of these cannot be shot: Reel 2, scene 1 is not ready: no storyboard sheet.' })
  })
})
