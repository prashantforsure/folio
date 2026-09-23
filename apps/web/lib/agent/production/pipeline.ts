import type { AgentAutonomy, AgentProposalStatus, AgentRunStatus, AssistantChatId, Episode, Generation, ProductionStage, RunStageName, StoryStageStatus } from '@folio/contracts'
import { GENERATION_COSTS, ProductionStageOutputSchemas } from '@folio/contracts'
import type { JobOutcome, ProjectScope, RunStage } from '@folio/db'
import { listLiveGenerations, readAgentRun, readBalance, readEpisodeSettings, readProposal, readRunStages, saveRunStage, setRunStageStatus } from '@folio/db'
import type { RunId } from '@folio/script'
import type { z } from 'zod'

import type { Ground } from '../../production/generate-core'
import { ground, isFailure } from '../../production/generate-core'
import type { Failure } from '../../production/result'
import type { EpisodeGate, GateRefusal } from '../../script/actor-gate'
import { isRefusal } from '../../script/actor-gate'
import { runDetached } from '../../script/server'
import type { ProposalSink } from '../loop'
import { proposalSink } from '../proposer'
import type { ProposedOp } from '../registry'
import { describeImages, describeShoot } from '../tools/writes-paid'
import { costTable, costTableText, credits, flagWords, imagesToDraw, missingPlates, reelLabel, shootPlan, totalOf } from './plan'

/**
 * The script-to-production pipeline - roadmap task 5.1, ADR 0003 D3/D4/D5.
 *
 * `script_to_production` starts a background run whose input is only a title:
 * the episode is the run's own. The worker calls this for each of its jobs. A
 * job reads the stages stored so far (`agent_run_stages`), carries on from the
 * one it reached, and stops for the writer where the plan says to:
 *
 *   setup   the episode's settings (unsaved ones only - they lock at the
 *           first shoot) and a reel for every scene without one, one proposal
 *           → waits until it is applied or rejected
 *   shots   a shotlist drafted for every empty reel (`ai_shotlist`, free),
 *           landing as proposed shots → **checkpoint**: accept the shots in
 *           Production, then Approve
 *   plates  only when a scene's location has no photo, which a shoot needs →
 *           **checkpoint**: upload photos, or Approve and the images include a
 *           plate drawn from each description (the client's ruling, 2026-09-24)
 *   images  the cost table (`GENERATION_COSTS`: plates, scene images, sheets,
 *           frames, and the shoots to come) with the balance, then **one paid
 *           proposal** for every image still missing → confirmed; the job
 *           then waits on the generations it started, polling their rows as
 *           the Production route does, and plans again for any that failed
 *   shoot   **one paid proposal** shooting every reel that is ready,
 *           confirmed separately; the reels that are not ready are named
 *           with why → waits on the shoots, then plans again until every reel
 *           is shot or the writer says no
 *
 * **It never calls a model of its own** - Production's jobs do the drawing -
 * so it needs no `ANTHROPIC_API_KEY` and spends no tokens. **It never spends
 * without a confirmation**: the images and the shoots are paid proposals, and
 * only the writer's confirmation grants the run the credits each names (D3,
 * `apply.ts`); a paid operation spends from that grant and nothing else.
 *
 * Its dependencies are injected (`ProductionPorts`), the defaults being the
 * repositories and Production's cores, so the whole walk is tested in memory.
 */

export type ProductionPorts = {
  readonly stages: (scope: ProjectScope, runId: RunId) => Promise<ReadonlyMap<RunStageName, RunStage>>
  readonly saveStage: (scope: ProjectScope, runId: RunId, stage: ProductionStage, status: StoryStageStatus, output: unknown) => Promise<void>
  readonly setStageStatus: (scope: ProjectScope, runId: RunId, stage: ProductionStage, status: StoryStageStatus) => Promise<void>
  readonly runStatus: (scope: ProjectScope, runId: RunId) => Promise<AgentRunStatus | null>
  readonly ground: (gate: EpisodeGate) => Promise<Ground | Failure>
  /** Whether the episode has settings saved - unsaved ones are proposed. */
  readonly settingsSaved: (gate: EpisodeGate) => Promise<boolean>
  readonly live: (gate: EpisodeGate) => Promise<readonly Generation[]>
  readonly balance: (scope: ProjectScope) => Promise<number>
  readonly proposalStatus: (scope: ProjectScope, id: string) => Promise<AgentProposalStatus | null>
  readonly sink: (gate: EpisodeGate) => ProposalSink
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  readonly now: () => number
}

export type ProductionJob = {
  readonly scope: ProjectScope
  readonly runId: RunId
  readonly chatId: AssistantChatId
  readonly episode: Episode
  /** The run's gate re-opened as its starter (ADR 0003 D4) - before every stage. */
  readonly open: () => Promise<EpisodeGate | GateRefusal>
  readonly signal: AbortSignal
  readonly autonomy: AgentAutonomy
  /** Post a message to the run's chat, as the assistant. */
  readonly say: (body: string) => Promise<void>
  readonly settle: (status: 'succeeded' | 'failed' | 'waiting_for_user' | 'cancelled', message: string | null) => Promise<JobOutcome>
  readonly ports?: Partial<ProductionPorts>
}

/** How long one job waits on generations before it hands back to the writer. */
export const IMAGE_WAIT_MS = 10 * 60_000
export const SHOOT_WAIT_MS = 20 * 60_000
export const POLL_MS = 5_000
/** Rounds of images or shoots before failures stop being re-proposed. */
export const MAX_ROUNDS = 3

/** What the run card says while the run waits at each stop. */
export const PRODUCTION_WAITING = {
  setup: 'Waiting for you to apply the episode settings and reels.',
  shots: 'Accept the shots you want in Production, then press Approve.',
  plates: 'Upload the missing location photos, or press Approve to have plates drawn.',
  images: 'Waiting for you to confirm the images and their cost.',
  drawing: 'The images are still drawing. Reply to check again.',
  shoot: 'Waiting for you to confirm the shoots and their cost.',
  shooting: 'The reels are still shooting. Reply to check again.',
  notReady: 'No reel is ready to shoot yet. Fix what is listed, then reply.',
} as const

const defaults = (job: ProductionJob): ProductionPorts => ({
  stages: readRunStages,
  saveStage: saveRunStage,
  setStageStatus: setRunStageStatus,
  runStatus: async (scope, runId) => (await readAgentRun(scope, runId))?.status ?? null,
  ground,
  settingsSaved: async (gate) => (await readEpisodeSettings(gate.scope, gate.episode.id)) !== null,
  live: (gate) => listLiveGenerations(gate.scope, gate.episode.id),
  balance: async (scope) => (await readBalance(scope)).available,
  proposalStatus: async (scope, id) => (await readProposal(scope, id as Parameters<typeof readProposal>[1]))?.proposal.status ?? null,
  sink: (gate) => proposalSink(gate, job.runId, job.autonomy, runDetached),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    }),
  now: Date.now,
})

/** A stop the pipeline cannot go past: failed, cancelled, waiting - already settled. */
class Halt extends Error {
  constructor(readonly outcome: JobOutcome) {
    super('halt')
  }
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`

export const runProductionJob = async (job: ProductionJob): Promise<JobOutcome> => {
  const ports: ProductionPorts = { ...defaults(job), ...job.ports }
  const { scope, runId, signal } = job

  /** Before a stage: still running, and still the starter's to run (D4). */
  const step = async (): Promise<EpisodeGate> => {
    if ((await ports.runStatus(scope, runId)) !== 'running') throw new Halt({ status: 'cancelled' })
    const gate = await job.open()
    if (isRefusal(gate)) throw new Halt(await job.settle('failed', gate.message))
    return gate
  }

  const wait = async (message: string | null, waiting: string): Promise<never> => {
    if (message !== null) await job.say(message)
    throw new Halt(await job.settle('waiting_for_user', waiting))
  }

  const read = async (gate: EpisodeGate): Promise<Ground> => {
    const g = await ports.ground(gate)
    if (isFailure(g)) throw new Halt(await job.settle('failed', g.message))
    return g
  }

  const stages = await ports.stages(scope, runId)
  const stored = <S extends ProductionStage>(stage: S): { readonly status: StoryStageStatus; readonly output: z.infer<(typeof ProductionStageOutputSchemas)[S]> } | null => {
    const row = stages.get(stage)
    if (row === undefined) return null
    const parsed = ProductionStageOutputSchemas[stage].safeParse(row.output)
    return parsed.success ? { status: row.status, output: parsed.data as z.infer<(typeof ProductionStageOutputSchemas)[S]> } : null
  }

  /** One proposal from these operations, keyed so a replayed job finds it again. */
  const propose = async (gate: EpisodeGate, key: string, ops: readonly ProposedOp[]): Promise<string> => {
    const [made] = await ports.sink(gate).create([{ ops: ops.map((op, index) => ({ key: `${key}:${String(index)}`, op })) }])
    if (made === undefined) throw new Error('Folio: the proposal was not written.')
    return made.proposalId
  }

  /**
   * Wait on the episode's live generations of these targets, polling their
   * rows as the Production route does, until none is live or `limit` passes.
   * A cancel or a shutdown ends the wait at once. Answers what is still live.
   */
  const settleOn = async (gate: EpisodeGate, targets: (generation: Generation) => boolean, limit: number): Promise<readonly Generation[]> => {
    const until = ports.now() + limit
    for (;;) {
      const live = (await ports.live(gate)).filter(targets)
      if (live.length === 0 || ports.now() >= until || signal.aborted) return live
      await ports.sleep(POLL_MS, signal)
      if (signal.aborted) return live
      if ((await ports.runStatus(scope, runId)) !== 'running') throw new Halt({ status: 'cancelled' })
    }
  }

  try {
    // ---------------------------------------------------------------- setup
    let gate = await step()
    const setup = stored('production_setup')
    if (setup === null) {
      const g = await read(gate)
      const ops: ProposedOp[] = []
      const saved = await ports.settingsSaved(gate)
      if (!saved && g.settings.lockedAt === null) {
        const settings = { aspectRatio: g.settings.aspectRatio, productionType: g.settings.productionType, cameraStyle: g.settings.cameraStyle, pacing: g.settings.pacing, lighting: g.settings.lighting, artStyleId: g.settings.artStyleId }
        ops.push({
          tool: 'save_episode_settings',
          args: { episode: job.episode.slug, episodeId: job.episode.id, settings, edited: Object.keys(settings) },
          mode: 'propose',
          description: `Episode settings: ${settings.aspectRatio}, ${settings.productionType}, ${g.artStyle.name} - they lock at the first shoot`,
        })
      }
      const bare = g.scenes.filter((scene) => scene.reels.length === 0)
      for (const scene of bare) {
        ops.push({ tool: 'manage_reels', args: { action: 'add', episode: job.episode.slug, sceneId: scene.sceneNodeId }, mode: 'propose', description: `Add a reel to scene ${String(scene.number)}` })
      }
      if (g.scenes.length === 0) {
        await job.say('This episode has no scenes in Production yet. Write or apply the script first, then start again.')
        return await job.settle('succeeded', null)
      }
      if (ops.length === 0) {
        await ports.saveStage(scope, runId, 'production_setup', 'approved', { proposalId: null })
      } else {
        const proposalId = await propose(gate, `production:${runId}:setup`, ops)
        await ports.saveStage(scope, runId, 'production_setup', 'waiting', { proposalId })
        const settingsLine = saved || g.settings.lockedAt !== null ? '' : ` The episode settings are proposed as ${g.settings.aspectRatio}, ${g.settings.productionType}, in the ${g.artStyle.name} style. Change them in Production before you apply if you want others: they lock at the first shoot.`
        await wait(
          `I proposed ${bare.length === 0 ? 'the episode settings' : `a reel for each of ${plural(bare.length, 'scene', 'scenes')} without one`}.${settingsLine} Apply it, then reply to carry on.`,
          PRODUCTION_WAITING.setup,
        )
      }
    } else if (setup.status === 'waiting') {
      const status = setup.output.proposalId === null ? 'applied' : await ports.proposalStatus(scope, setup.output.proposalId)
      if (status === 'pending') await wait('The settings and reels are still waiting for you. Apply them, then reply.', PRODUCTION_WAITING.setup)
      await ports.setStageStatus(scope, runId, 'production_setup', 'approved')
    }

    // ---------------------------------------------------------------- shots
    gate = await step()
    const shots = stored('production_shots')
    if (shots === null) {
      const g = await read(gate)
      const reels = g.scenes.flatMap((scene) => scene.reels.map((reel) => ({ scene, reel })))
      if (reels.length === 0) {
        await job.say('There are no reels to make. Apply the reels, or add one in Production, then start again.')
        return await job.settle('succeeded', null)
      }
      const live = new Set((await ports.live(gate)).map((generation) => generation.targetId))
      const empty = reels.filter(({ reel }) => reel.shots.length === 0 && !live.has(reel.id))
      const sink = ports.sink(gate)
      for (const { scene, reel } of empty) {
        const label = reelLabel(scene, reel)
        await sink.applyNow({ tool: 'ai_shotlist', args: { episode: job.episode.slug, reelId: reel.id, label }, mode: 'direct', description: `Draft a shotlist for ${label}` }, `production:${runId}:shotlist:${reel.id}`)
      }
      // The shotlists draw on the worker too; the checkpoint is more use once they have landed.
      await settleOn(gate, (generation) => generation.job === 'ai_shotlist', IMAGE_WAIT_MS)
      const after = await read(gate)
      const proposed = after.scenes.flatMap((scene) => scene.reels.flatMap((reel) => reel.shots.filter((shot) => shot.proposed))).length
      await ports.saveStage(scope, runId, 'production_shots', 'waiting', { reels: empty.map(({ reel }) => reel.id) })
      await wait(
        `${empty.length === 0 ? 'Every reel already has shots.' : `I drafted shotlists for ${plural(empty.length, 'reel', 'reels')}.`} ${proposed === 0 ? 'There are no proposed shots waiting.' : `${plural(proposed, 'proposed shot waits', 'proposed shots wait')} for you in Production: accept the ones you want - a proposed shot is not shot.`} Press Approve when the shotlists are how you want them.`,
        PRODUCTION_WAITING.shots,
      )
    } else if (shots.status === 'waiting') {
      await wait('Press Approve once the shots are accepted. Words here do not move this step on.', PRODUCTION_WAITING.shots)
    }

    // ---------------------------------------------------------------- plates
    gate = await step()
    let g = await read(gate)
    const plates = stored('production_plates')
    const missing = missingPlates(g.scenes)
    if (plates === null && missing.length > 0) {
      const known = missing.filter((place): place is { readonly id: string; readonly name: string } => place.id !== null)
      const unknown = missing.filter((place) => place.id === null)
      await ports.saveStage(scope, runId, 'production_plates', 'waiting', { locations: known })
      await wait(
        [
          `A shoot needs each scene's location photo as its plate, and ${plural(missing.length, 'location has', 'locations have')} none: ${missing.map((place) => place.name).join(', ')}.`,
          known.length === 0 ? '' : `Upload a photo for each in Locations, or press Approve and I will add a plate drawn from each location's description to the images, at ${credits(GENERATION_COSTS.location_plate)} each.`,
          unknown.length === 0 ? '' : `${unknown.map((place) => place.name).join(', ')} ${unknown.length === 1 ? 'has' : 'have'} no location record: resolve the slugline in Locations first.`,
        ]
          .filter((line) => line.length > 0)
          .join(' '),
        PRODUCTION_WAITING.plates,
      )
    } else if (plates !== null && plates.status === 'waiting') {
      await wait('Upload the photos, or press Approve to have plates drawn. Words here do not move this step on.', PRODUCTION_WAITING.plates)
    }
    const drawPlates = plates?.status === 'approved'

    // ---------------------------------------------------------------- images
    const images = stored('production_images')
    let skipImages = images?.status === 'approved'
    if (!skipImages) {
      gate = await step()
      let round = images?.output.round ?? 0
      if (images !== null && images.output.proposalId !== null) {
        const status = await ports.proposalStatus(scope, images.output.proposalId)
        if (status === 'pending') await wait('The images are still waiting for your confirmation. Confirm or reject them on the card, then reply.', PRODUCTION_WAITING.images)
        if (status === 'rejected') {
          await ports.saveStage(scope, runId, 'production_images', 'approved', { proposalId: null, round })
          await job.say('You said no to the images, so I will go on to shooting with what is drawn.')
          skipImages = true
        }
      }
      if (!skipImages) {
        const stillLive = await settleOn(gate, (generation) => generation.job !== 'shoot_reel' && generation.job !== 'ai_shotlist', IMAGE_WAIT_MS)
        if (stillLive.length > 0) await wait(`${plural(stillLive.length, 'image is', 'images are')} still drawing. Reply and I will check again.`, PRODUCTION_WAITING.drawing)
        g = await read(gate)
        const live = new Set((await ports.live(gate)).map((generation) => generation.targetId))
        const items = imagesToDraw({ scenes: g.scenes, live, plates: drawPlates })
        if (items.length === 0 || round >= MAX_ROUNDS) {
          if (items.length > 0) await job.say(`${plural(items.length, 'image', 'images')} did not draw after ${String(MAX_ROUNDS)} tries; I will go on without ${items.length === 1 ? 'it' : 'them'}. Draw ${items.length === 1 ? 'it' : 'them'} in Production if the shoot needs ${items.length === 1 ? 'it' : 'them'}.`)
          await ports.saveStage(scope, runId, 'production_images', 'approved', { proposalId: null, round })
        } else {
          round += 1
          const plan = shootPlan(g.scenes, live)
          const table = costTableText(costTable(items, plan.ready.length + plan.waiting.length), await ports.balance(scope))
          const total = totalOf(items)
          const proposalId = await propose(gate, `production:${runId}:images:${String(round)}`, [
            { tool: 'generate_images', args: { episode: job.episode.slug, items }, mode: 'paid', cost: total, description: describeImages(items) },
          ])
          await ports.saveStage(scope, runId, 'production_images', 'waiting', { proposalId, round })
          await wait(
            `${round === 1 ? 'Here is what the images cost, and what shooting the reels will cost after them' : 'Some images did not draw. Here they are again'}:\n\n${table}\n\nConfirm the images on the card (${credits(total)}). The shoots are confirmed on their own afterwards. Reply once you have confirmed.`,
            PRODUCTION_WAITING.images,
          )
        }
      }
    }

    // ---------------------------------------------------------------- shoot
    gate = await step()
    const shoot = stored('production_shoot')
    let round = shoot?.output.round ?? 0
    if (shoot !== null && shoot.output.proposalId !== null) {
      const status = await ports.proposalStatus(scope, shoot.output.proposalId)
      if (status === 'pending') await wait('The shoots are still waiting for your confirmation. Confirm or reject them on the card, then reply.', PRODUCTION_WAITING.shoot)
      if (status === 'rejected') {
        await ports.saveStage(scope, runId, 'production_shoot', 'approved', { proposalId: null, round })
        await job.say('You said no to the shoots. Everything drawn is in Production; shoot a reel there when you are ready.')
        return await job.settle('succeeded', null)
      }
    }
    const stillShooting = await settleOn(gate, (generation) => generation.job === 'shoot_reel', SHOOT_WAIT_MS)
    if (stillShooting.length > 0) await wait(`${plural(stillShooting.length, 'reel is', 'reels are')} still shooting. Reply and I will check again.`, PRODUCTION_WAITING.shooting)
    g = await read(gate)
    const live = new Set((await ports.live(gate)).map((generation) => generation.targetId))
    const plan = shootPlan(g.scenes, live)
    if (plan.ready.length === 0 && plan.waiting.length === 0) {
      await ports.saveStage(scope, runId, 'production_shoot', 'approved', { proposalId: null, round })
      await job.say(`Every reel is shot: ${plural(plan.shot, 'clip', 'clips')} in Production.`)
      return await job.settle('succeeded', null)
    }
    const notReady = plan.waiting.map((reel) => `${reel.label}: ${flagWords(reel.failed)}`)
    if (plan.ready.length === 0 || round >= MAX_ROUNDS) {
      await ports.saveStage(scope, runId, 'production_shoot', 'ready', { proposalId: null, round })
      await wait(
        `${plural(plan.shot, 'reel is', 'reels are')} shot. ${plan.ready.length === 0 ? 'None of the rest is ready' : 'The rest did not shoot after three tries'}:\n\n${notReady.map((line) => `- ${line}`).join('\n')}\n\nFix these in Production, then reply and I will propose the shoots.`,
        PRODUCTION_WAITING.notReady,
      )
    }
    round += 1
    const reels = plan.ready.map((reel) => ({ reelId: reel.reelId, label: reel.label, cost: GENERATION_COSTS.shoot_reel }))
    const args = { episode: job.episode.slug, reels, locks: g.settings.lockedAt === null }
    const proposalId = await propose(gate, `production:${runId}:shoot:${String(round)}`, [{ tool: 'shoot_reel', args, mode: 'paid', cost: totalOf(reels), description: describeShoot(args) }])
    await ports.saveStage(scope, runId, 'production_shoot', 'waiting', { proposalId, round })
    return await wait(
      [
        `${plural(reels.length, 'reel is', 'reels are')} ready to shoot, for ${credits(totalOf(reels))}. You have ${credits(await ports.balance(scope))} available.`,
        args.locks ? 'The first shoot locks the episode settings.' : '',
        notReady.length === 0 ? '' : `Not ready yet: ${notReady.join('; ')}.`,
        'Confirm the shoots on the card, then reply.',
      ]
        .filter((line) => line.length > 0)
        .join(' '),
      PRODUCTION_WAITING.shoot,
    )
  } catch (cause) {
    if (cause instanceof Halt) return cause.outcome
    if (signal.aborted) {
      // A shutdown or a lost lease writes nothing; the next claim resumes at the stage reached.
      if (signal.reason !== 'cancel') return { status: 'failed', error: 'Stopped by the worker.' }
      return job.settle('cancelled', null)
    }
    // The database's: thrown, so the runtime retries the job.
    throw cause
  }
}
