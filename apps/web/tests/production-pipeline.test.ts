// @vitest-environment node
import type { AgentProposalStatus, Episode, Generation, ProductionScene, RunStageName, StoryStageStatus } from '@folio/contracts'
import { GENERATION_COSTS, assistantChatId, episodeId, episodeSlug, projectId } from '@folio/contracts'
import type { JobOutcome, ProjectScope, RunStage } from '@folio/db'
import { runId } from '@folio/script'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProductionPorts } from '../lib/agent/production/pipeline'
import { PRODUCTION_WAITING, runProductionJob } from '../lib/agent/production/pipeline'
import type { ProposedOp } from '../lib/agent/registry'
import { credits } from '../lib/agent/production/plan'
import { reel, scene, shot, uid } from './helpers/production-fixtures'

/**
 * The script-to-production pipeline end to end - roadmap task 5.1.
 *
 * The episode is in memory and "the writer" does between jobs what they would
 * do on the cards and in Production: apply the setup, accept the shots, press
 * Approve at the two checkpoints, confirm the images and then, separately,
 * the shoots. What is held: every stop is where the plan puts it; the images
 * and the shoots are **two paid proposals**, each priced from
 * `GENERATION_COSTS` and each needing its own confirmation, with the cost
 * table and the balance said before the first; words at a checkpoint never
 * move it on; a rejected spend is never re-asked in a loop; a cancel stops it.
 */

const RUN = runId('3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a98')
const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode

type Proposal = { status: AgentProposalStatus; ops: ProposedOp[] }

let world: {
  scenes: ProductionScene[]
  stages: Map<RunStageName, RunStage>
  proposals: Map<string, Proposal>
  direct: ProposedOp[]
  live: Generation[][]
  said: string[]
  settled: { status: string; message: string | null }[]
  runStatus: 'running' | 'cancelled'
  settingsSaved: boolean
  balance: number
  sleeps: number
}

const GATE = { actor: 'u' as never, scope: {} as ProjectScope, project: { id: PROJECT }, episode: EPISODE, role: 'writer' as const }

const liveGen = (target: string, job: Generation['job']): Generation => ({ id: uid('gen', 1) as Generation['id'], episodeId: EPISODE.id, targetType: 'reel', targetId: target, job, state: 'running', progress: 10, refusalReason: null, creditsReserved: 40, creditsCharged: 0, route: null, startedAt: null, finishedAt: null, createdAt: '' })

const ports: ProductionPorts = {
  stages: () => Promise.resolve(new Map([...world.stages].map(([key, row]) => [key, { ...row }]))),
  saveStage: (_scope, _run, stage, status, output) => {
    world.stages.set(stage, { stage, status, output: JSON.parse(JSON.stringify(output)) as unknown })
    return Promise.resolve()
  },
  setStageStatus: (_scope, _run, stage, status) => {
    const row = world.stages.get(stage)
    if (row !== undefined) world.stages.set(stage, { ...row, status })
    return Promise.resolve()
  },
  runStatus: () => Promise.resolve(world.runStatus),
  ground: () =>
    Promise.resolve({
      gate: GATE as never,
      scenes: world.scenes,
      settings: { episodeId: EPISODE.id, aspectRatio: '16:9 landscape', productionType: 'Narrative', cameraStyle: 'Academy', pacing: 'Balanced', lighting: 'Motivated', artStyleId: uid('gen', 7) as never, lockedAt: null },
      artStyle: { name: 'Netflix Prestige Drama' } as never,
      names: [],
    }),
  settingsSaved: () => Promise.resolve(world.settingsSaved),
  live: () => Promise.resolve(world.live.shift() ?? []),
  balance: () => Promise.resolve(world.balance),
  proposalStatus: (_scope, id) => Promise.resolve(world.proposals.get(id)?.status ?? null),
  sink: () => ({
    create: (groups) =>
      Promise.resolve(
        groups.map((group) => {
          const id = uid('gen', 100 + world.proposals.size)
          world.proposals.set(id, { status: 'pending', ops: group.ops.map((entry) => entry.op) })
          return { proposalId: id, runId: RUN, summary: 's', needsConfirmation: false, auto: false }
        }),
      ),
    applyNow: (op) => {
      world.direct.push(op)
      // The AI shotlist lands as proposed shots in the reel.
      const reelId = (op.args as { reelId: string }).reelId
      world.scenes = world.scenes.map((entry) => ({ ...entry, reels: entry.reels.map((r) => (r.id === reelId ? { ...r, shots: [shot(1, { proposed: true }), shot(2, { proposed: true }), shot(3, { proposed: true })].map((s, i) => ({ ...s, id: uid('shot', Number(r.id.slice(-2)) * 10 + i + 1) as never, reelId: r.id })) } : r)) }))
      return Promise.resolve({ ok: true, proposalId: uid('gen', 90), result: null })
    },
  }),
  sleep: () => {
    world.sleeps += 1
    return Promise.resolve()
  },
  now: () => 0,
}

const job = () =>
  runProductionJob({
    scope: {} as ProjectScope,
    runId: RUN,
    chatId: assistantChatId('5f4e3d2c-1b0a-4987-8654-3210fedcba98'),
    episode: EPISODE,
    open: () => Promise.resolve(GATE as never),
    signal: new AbortController().signal,
    autonomy: 'review',
    say: (body) => {
      world.said.push(body)
      return Promise.resolve()
    },
    settle: (status, message): Promise<JobOutcome> => {
      world.settled.push({ status, message })
      return Promise.resolve(status === 'failed' ? { status: 'failed', error: message ?? '' } : { status: 'finished' })
    },
    ports,
  })

const last = <T>(list: readonly T[]): T | undefined => list.at(-1)
const stageStatus = (stage: RunStageName): StoryStageStatus | undefined => world.stages.get(stage)?.status
const proposal = (index: number): Proposal => [...world.proposals.values()][index] as Proposal
const decide = (index: number, status: AgentProposalStatus): void => {
  const id = [...world.proposals.keys()][index]
  if (id !== undefined) world.proposals.set(id, { ...proposal(index), status })
}
const approve = (stage: RunStageName): void => {
  const row = world.stages.get(stage)
  if (row !== undefined) world.stages.set(stage, { ...row, status: 'approved' })
}
const mapReels = (fn: (r: ProductionScene['reels'][number], s: ProductionScene) => ProductionScene['reels'][number]): void => {
  world.scenes = world.scenes.map((s) => ({ ...s, reels: s.reels.map((r) => fn(r, s)) }))
}

beforeEach(() => {
  world = {
    scenes: [
      scene(1, [], { stillState: 'empty', plateReady: false, locationName: 'Jetty' }),
      scene(2, [], { stillState: 'empty', plateReady: true, locationId: uid('location', 2) as never, locationName: 'Ferry deck' }),
    ],
    stages: new Map(),
    proposals: new Map(),
    direct: [],
    live: [],
    said: [],
    settled: [],
    runStatus: 'running',
    settingsSaved: false,
    balance: 5_000,
    sleeps: 0,
  }
})

describe('script_to_production', () => {
  it('walks an episode from no reels to every reel shot, stopping where the plan says and asking twice before it spends', async () => {
    // Job 1 - the settings (they lock at the first shoot) and a reel per scene, one proposal.
    await job()
    expect(last(world.settled)).toEqual({ status: 'waiting_for_user', message: PRODUCTION_WAITING.setup })
    expect(proposal(0).ops.map((op) => op.tool)).toEqual(['save_episode_settings', 'manage_reels', 'manage_reels'])
    expect(proposal(0).ops.every((op) => op.mode === 'propose')).toBe(true)
    expect(last(world.said)).toContain('they lock at the first shoot')

    // The writer applies it: each scene has an empty reel.
    decide(0, 'applied')
    world.settingsSaved = true
    world.scenes = world.scenes.map((s) => ({ ...s, reels: [reel(s.number, s.number, { shots: [] })] }))

    // Job 2 - a shotlist per empty reel (free, direct), then the shots checkpoint.
    await job()
    expect(world.direct.map((op) => [op.tool, op.mode])).toEqual([
      ['ai_shotlist', 'direct'],
      ['ai_shotlist', 'direct'],
    ])
    expect(last(world.settled)).toEqual({ status: 'waiting_for_user', message: PRODUCTION_WAITING.shots })
    expect(last(world.said)).toContain('6 proposed shots wait for you in Production')

    // Words at a checkpoint do not move it on.
    await job()
    expect(stageStatus('production_shots')).toBe('waiting')
    expect(last(world.settled)?.message).toBe(PRODUCTION_WAITING.shots)

    // The writer accepts the shots and presses Approve.
    mapReels((r) => ({ ...r, shots: r.shots.map((s) => ({ ...s, proposed: false })) }))
    approve('production_shots')

    // Job 3 - a location has no photo: the plates checkpoint.
    await job()
    expect(last(world.settled)).toEqual({ status: 'waiting_for_user', message: PRODUCTION_WAITING.plates })
    expect(last(world.said)).toContain('Jetty')
    expect(last(world.said)).toContain(`${credits(GENERATION_COSTS.location_plate)} each`)
    approve('production_plates')

    // Job 4 - the cost table and the balance, then ONE paid proposal for every image.
    await job()
    const images = proposal(1)
    expect(images.ops).toHaveLength(1)
    expect(images.ops[0]).toMatchObject({ tool: 'generate_images', mode: 'paid' })
    const imageCost = GENERATION_COSTS.location_plate + 2 * GENERATION_COSTS.scene_image + 2 * GENERATION_COSTS.storyboard_sheet + 6 * GENERATION_COSTS.shot_frame
    expect(images.ops[0]?.cost).toBe(imageCost)
    const table = last(world.said) ?? ''
    expect(table).toContain(`1 location plate at ${String(GENERATION_COSTS.location_plate)} each`)
    expect(table).toContain(`2 reel shoots at ${String(GENERATION_COSTS.shoot_reel)} each: ${credits(2 * GENERATION_COSTS.shoot_reel)}`)
    expect(table).toContain(`Total: ${credits(imageCost + 2 * GENERATION_COSTS.shoot_reel)}. You have ${credits(5_000)} available.`)
    expect(last(world.settled)?.message).toBe(PRODUCTION_WAITING.images)

    // A reply before confirming changes nothing: still waiting on the card.
    await job()
    expect(world.proposals.size).toBe(2)
    expect(last(world.settled)?.message).toBe(PRODUCTION_WAITING.images)

    // The writer confirms; the images draw (one is still drawing when the job looks).
    decide(1, 'applied')
    world.live = [[liveGen(uid('reel', 1), 'storyboard_sheet')], []]
    world.scenes = world.scenes.map((s) => ({ ...s, plateReady: true, stillState: 'drawn' }))
    mapReels((r) => ({ ...r, sheet: { id: uid('sheet', 1) as never, reelId: r.id, state: 'done', asset: null, progress: null, generatedAt: null, creditsSpent: 40, artStyleId: null, generationId: null, frames: [] }, shots: r.shots.map((s) => ({ ...s, frameState: 'drawn' })) }))

    // Job 5 - waits out the drawing, then ONE separate paid proposal for the shoots.
    await job()
    expect(world.sleeps).toBe(1)
    expect(stageStatus('production_images')).toBe('approved')
    const shoots = proposal(2)
    expect(shoots.ops).toEqual([expect.objectContaining({ tool: 'shoot_reel', mode: 'paid', cost: 2 * GENERATION_COSTS.shoot_reel })])
    expect(shoots.ops[0]?.args).toMatchObject({ locks: true, reels: [{ reelId: uid('reel', 1) }, { reelId: uid('reel', 2) }] })
    expect(last(world.said)).toContain('The first shoot locks the episode settings.')
    expect(last(world.settled)?.message).toBe(PRODUCTION_WAITING.shoot)

    // The writer confirms the shoots; the clips render.
    decide(2, 'applied')
    mapReels((r) => ({ ...r, clip: { id: uid('clip', 1) as never, reelId: r.id, state: 'rendered', version: 1, poster: null, video: null, creditsSpent: 375, generationId: null, createdAt: '' } }))

    // Job 6 - done.
    await job()
    expect(last(world.said)).toBe('Every reel is shot: 2 clips in Production.')
    expect(last(world.settled)).toEqual({ status: 'succeeded', message: null })
    // Three proposals, two of them paid - never a paid step inside another stage's proposal.
    expect([...world.proposals.values()].map((entry) => entry.ops.map((op) => op.mode))).toEqual([['propose', 'propose', 'propose'], ['paid'], ['paid']])
  })

  it('goes on to shooting when the writer says no to the images, and ends when they say no to the shoots', async () => {
    world.settingsSaved = true
    world.scenes = world.scenes.map((s) => ({ ...s, plateReady: true, reels: [reel(s.number, s.number)] }))
    world.stages.set('production_setup', { stage: 'production_setup', status: 'approved', output: { proposalId: null } })
    world.stages.set('production_shots', { stage: 'production_shots', status: 'approved', output: { reels: [] } })

    await job()
    expect(proposal(0).ops[0]?.tool).toBe('generate_images')
    decide(0, 'rejected')

    await job()
    expect(world.said).toContain('You said no to the images, so I will go on to shooting with what is drawn.')
    // Nothing is ready without the sheets, so there is nothing to shoot - named, and it waits.
    expect(world.proposals.size).toBe(1)
    expect(last(world.settled)?.message).toBe(PRODUCTION_WAITING.notReady)
    expect(last(world.said)).toContain('Reel 1, scene 1: no storyboard sheet')
  })

  it('stops at once when the run is cancelled, settling nothing', async () => {
    world.runStatus = 'cancelled'
    expect(await job()).toEqual({ status: 'cancelled' })
    expect(world.settled).toEqual([])
    expect(world.proposals.size).toBe(0)
  })

  it('ends at once when the episode has no scenes', async () => {
    world.scenes = []
    await job()
    expect(last(world.settled)).toEqual({ status: 'succeeded', message: null })
    expect(world.proposals.size).toBe(0)
  })
})

vi.setConfig({ testTimeout: 20_000 })
