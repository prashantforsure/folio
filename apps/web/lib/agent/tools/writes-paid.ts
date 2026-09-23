import type { GenerationJob } from '@folio/contracts'
import { GENERATION_COSTS, LocationIdSchema, NodeIdSchema, ReelIdSchema, ReelShotIdSchema } from '@folio/contracts'
import { listLiveGenerations, listLocationRecords, returnRunBudget, spendRunBudget } from '@folio/db'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { readinessOf } from '../../production/derive'
import type { FrameLaunch } from '../../production/generate-core'
import {
  generateFramesEachWith,
  generateLocationPlateWith,
  generateSceneImageWith,
  generateSheetWith,
  ground,
  isFailure,
  isLaunches,
  shootReelWith,
} from '../../production/generate-core'
import { connected } from '../../production/pipeline/connection'
import type { GenerationResult, ShootResult } from '../../production/result'
import type { EpisodeGate } from '../../script/actor-gate'
import { isRefusal } from '../../script/actor-gate'
import { episodeNumbered } from '../document-ops'
import { inEpisode } from '../episode-gate'
import type { ExecContext, ExecOutcome } from '../executors'
import type { ImageItem } from '../production/plan'
import { IMAGE_ORDER, ImageItemSchema, costTable, credits, flagWords, reelLabel, totalOf } from '../production/plan'
import type { ToolContext } from '../registry'
import type { Prepared, WriteTool } from '../write-tool'
import { defineWriteTool } from '../write-tool'

/**
 * The paid tools - `docs/agents/tools.md`, *Production*, the Phase 5 rows,
 * roadmap task 5.1, ADR 0003 **D1** and **D3**.
 *
 * Both are **paid**: the call is priced from `GENERATION_COSTS` when it is
 * made (`prepare`), the proposal carries the price, and nothing runs until the
 * writer confirms it on a card that shows the price and their balance - in
 * either autonomy setting. The confirmation grants the run exactly that many
 * credits (`apply.ts`); each image or shoot spends from the grant before it
 * starts (`spendRunBudget`) and gives back what never started, so the run can
 * never spend past what a person saw and said yes to.
 *
 * One call is one operation and one confirmation, however many images it
 * names: the production pipeline confirms an episode's images once and its
 * shoots once, and a turn asked for three frames does not ask three times.
 * The generations are Production's own - the same cores the route's buttons
 * call (`lib/production/generate-core.ts`), queued on the worker, polled by
 * the route while they draw. Nothing here can be undone: a spent credit is
 * spent, and the card says so before the click.
 */

const EpisodeNumber = z.number().int().min(1).optional().describe('The episode, by its number. Omit for the one the writer has open.')

/** The episode an operation names, as a gate its cores take. */
const episodeGateFor = async (ctx: { readonly gate: ToolContext['gate'] }, ordinal: number | undefined): Promise<EpisodeGate | string> => {
  const episode = await episodeNumbered(ctx.gate, ordinal)
  if (episode === null) return `There is no episode ${String(ordinal)}.`
  const gate = await inEpisode(ctx.gate, episode.slug, (narrowed) => Promise.resolve(narrowed))
  return isRefusal(gate) ? gate.message : gate
}

/** A result that did not start work, in the writer's terms. */
const reasonOf = (result: GenerationResult | ShootResult): string => {
  switch (result.status) {
    case 'queued':
      return ''
    case 'insufficient':
      return `There are not enough credits: ${credits(result.cost)} needed, ${credits(result.available)} available.`
    case 'not_ready':
      return `It is not ready to shoot: ${flagWords(result.failed)}.`
    default:
      return result.message
  }
}

/** Once one of these comes back, nothing after it in the operation can start either. */
const stopsTheRest = (result: GenerationResult | ShootResult): boolean => result.status === 'insufficient' || result.status === 'rate-limited' || result.status === 'disconnected'

export type LaunchReport = {
  readonly started: readonly string[]
  readonly notStarted: readonly { readonly label: string; readonly reason: string }[]
  /** Credits spent from the run's grant - what started. */
  readonly spent: number
}

type Launchable = { readonly label: string; readonly cost: number; readonly start: (gate: EpisodeGate) => Promise<{ readonly started: number; readonly of: number; readonly result: GenerationResult | ShootResult }> }

/**
 * Start each item in order, spending from the run's grant before each and
 * giving back what did not start. The first refusal the rest would meet too
 * (the balance, the hour's limit, a model not connected) stops the rest.
 */
const launchAll = async (ctx: ExecContext, slug: string, items: readonly Launchable[]): Promise<ExecOutcome> => {
  const { scope } = ctx.gate
  const started: string[] = []
  const notStarted: { label: string; reason: string }[] = []
  let spent = 0
  let halted: string | null = null
  for (const item of items) {
    if (halted !== null) {
      notStarted.push({ label: item.label, reason: halted })
      continue
    }
    if (!(await spendRunBudget(scope, ctx.runId, item.cost))) {
      halted = 'It is past the credits you confirmed for this run.'
      notStarted.push({ label: item.label, reason: halted })
      continue
    }
    const outcome = await inEpisode(ctx.gate, slug, item.start)
    if (!('started' in outcome)) {
      await returnRunBudget(scope, ctx.runId, item.cost)
      halted = outcome.message
      notStarted.push({ label: item.label, reason: outcome.message })
      continue
    }
    // Spent on what started; the share of what did not goes back to the grant.
    const used = outcome.of === 0 ? 0 : Math.round((item.cost * outcome.started) / outcome.of)
    if (used < item.cost) await returnRunBudget(scope, ctx.runId, item.cost - used)
    spent += used
    if (outcome.started > 0) started.push(outcome.started === outcome.of ? item.label : `${item.label} (${String(outcome.started)} of ${String(outcome.of)})`)
    if (outcome.started < outcome.of) notStarted.push({ label: item.label, reason: reasonOf(outcome.result) || 'It could not start.' })
    if (stopsTheRest(outcome.result)) halted = reasonOf(outcome.result)
  }
  const report: LaunchReport = { started, notStarted, spent }
  if (started.length === 0) return { ok: false, message: notStarted[0]?.reason ?? 'Nothing could start.' }
  return { ok: true, result: report }
}

/** One core call: one thing started, or none. */
const single = (result: GenerationResult | ShootResult): { readonly started: number; readonly of: number; readonly result: GenerationResult | ShootResult } => ({
  started: result.status === 'queued' ? 1 : 0,
  of: 1,
  result,
})

/** A batch of frames: as many started as came back queued. */
const frames = (each: readonly FrameLaunch[] | GenerationResult, asked: number): { readonly started: number; readonly of: number; readonly result: GenerationResult } => {
  if (!isLaunches(each)) return { started: 0, of: asked, result: each }
  const queued = each.filter((entry) => entry.result.status === 'queued')
  const stopped = each.find((entry) => entry.result.status !== 'queued')
  const last = stopped?.result ?? each.at(-1)?.result ?? { status: 'error' as const, message: 'None of the shots could be drawn.' }
  return { started: queued.length, of: asked, result: queued.length === asked ? (queued.at(-1)?.result ?? last) : last }
}

const JOB_OF: Readonly<Record<ImageItem['kind'], GenerationJob>> = { plate: 'location_plate', scene_image: 'scene_image', sheet: 'storyboard_sheet', frames: 'shot_frame' }

// ---------------------------------------------------------------------------
// generate_images
// ---------------------------------------------------------------------------

const ImageRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plate'), locationId: LocationIdSchema.describe("A location with no photo: its plate is drawn from its description and becomes its photo.") }),
  z.object({ kind: z.literal('scene_image'), sceneId: NodeIdSchema.describe("The scene's heading node id.") }),
  z.object({ kind: z.literal('sheet'), reelId: ReelIdSchema }),
  z.object({ kind: z.literal('frames'), shotIds: z.array(ReelShotIdSchema).min(1).max(50) }),
])

type ImageRequest = z.infer<typeof ImageRequest>

/** Price and check a call's images against the episode as it is: each one it can draw, or why it cannot. */
export const priceImages = async (gate: EpisodeGate, requests: readonly ImageRequest[]): Promise<{ readonly items: readonly ImageItem[]; readonly problems: readonly string[] } | string> => {
  const g = await ground(gate)
  if (isFailure(g)) return g.message
  const [live, locations] = await Promise.all([listLiveGenerations(gate.scope, gate.episode.id), listLocationRecords(gate.scope)])
  const drawing = new Set<string>(live.map((generation) => generation.targetId))
  const items: ImageItem[] = []
  const problems: string[] = []
  const reels = g.scenes.flatMap((scene) => scene.reels.map((reel) => ({ scene, reel })))
  for (const request of requests) {
    switch (request.kind) {
      case 'plate': {
        const location = locations.find((record) => record.id === request.locationId)
        if (location === undefined) problems.push('A plate names a location that is not in this project.')
        else if (location.photoKey !== null) problems.push(`${location.name} already has a photo - that is its plate.`)
        else if (drawing.has(location.id)) problems.push(`${location.name}'s plate is already being drawn.`)
        else items.push({ kind: 'plate', locationId: location.id, label: `The plate for ${location.name}`, cost: GENERATION_COSTS.location_plate })
        break
      }
      case 'scene_image': {
        const scene = g.scenes.find((candidate) => candidate.sceneNodeId === request.sceneId)
        if (scene === undefined) problems.push('A scene image names a scene that is not in this episode.')
        else if (drawing.has(scene.sceneNodeId)) problems.push(`The scene image for scene ${String(scene.number)} is already being drawn.`)
        else items.push({ kind: 'scene_image', sceneId: scene.sceneNodeId, label: `The scene image for scene ${String(scene.number)}`, cost: GENERATION_COSTS.scene_image })
        break
      }
      case 'sheet': {
        const found = reels.find(({ reel }) => reel.id === request.reelId)
        if (found === undefined) problems.push('A sheet names a reel that is not in this episode.')
        else if (found.reel.shots.length === 0) problems.push(`${reelLabel(found.scene, found.reel)} has no shots - the sheet is drawn from the shotlist.`)
        else if (drawing.has(found.reel.id)) problems.push(`${reelLabel(found.scene, found.reel)} is already being drawn.`)
        else items.push({ kind: 'sheet', reelId: found.reel.id, label: `The storyboard sheet for ${reelLabel(found.scene, found.reel)}`, cost: GENERATION_COSTS.storyboard_sheet })
        break
      }
      case 'frames': {
        // One item per reel, so a reel's frames start in one core call.
        const byReel = new Map<string, string[]>()
        for (const shotId of new Set(request.shotIds)) {
          const found = reels.find(({ reel }) => reel.shots.some((shot) => shot.id === shotId))
          const shot = found?.reel.shots.find((candidate) => candidate.id === shotId)
          if (found === undefined || shot === undefined) problems.push('A frame names a shot that is not in this episode.')
          else if (shot.description.trim().length === 0) problems.push(`A shot in ${reelLabel(found.scene, found.reel)} has no description to draw from.`)
          else if (drawing.has(shot.id)) problems.push(`A frame in ${reelLabel(found.scene, found.reel)} is already being drawn.`)
          else byReel.set(found.reel.id, [...(byReel.get(found.reel.id) ?? []), shot.id])
        }
        for (const [reelId, shotIds] of byReel) {
          const found = reels.find(({ reel }) => reel.id === reelId)
          if (found === undefined) continue
          items.push({
            kind: 'frames',
            reelId,
            shotIds,
            label: `${String(shotIds.length)} ${shotIds.length === 1 ? 'frame' : 'frames'} for ${reelLabel(found.scene, found.reel)}`,
            cost: GENERATION_COSTS.shot_frame * shotIds.length,
          })
        }
        break
      }
    }
  }
  // Drawn in order: a plate before the scene image and the sheet it is the set of.
  items.sort((a, b) => IMAGE_ORDER.indexOf(a.kind) - IMAGE_ORDER.indexOf(b.kind))
  return { items, problems }
}

/** What `generate_images` stores: the episode and the priced items, in drawing order. */
export const ImagesArgsSchema = z.object({ episode: z.string(), items: z.array(ImageItemSchema).min(1) })

export type ImagesArgs = z.infer<typeof ImagesArgsSchema>

/** `Draw images for 282 credits: 2 location plates, 3 scene images, 12 frames` - code's words, from the table. */
export const describeImages = (items: readonly ImageItem[]): string =>
  `Draw images for ${credits(totalOf(items))}: ${costTable(items, 0)
    .map((line) => `${String(line.count)} ${line.label}`)
    .join(', ')}`

const startImage = (item: ImageItem): Launchable['start'] => {
  switch (item.kind) {
    case 'plate':
      return async (gate) => single(await generateLocationPlateWith(gate, item.locationId))
    case 'scene_image':
      return async (gate) => single(await generateSceneImageWith(gate, item.sceneId))
    case 'sheet':
      return async (gate) => single(await generateSheetWith(gate, item.reelId))
    case 'frames':
      return async (gate) => frames(await generateFramesEachWith(gate, item.shotIds), item.shotIds.length)
  }
}

export const generateImagesTool = defineWriteTool({
  name: 'generate_images',
  description:
    "Draw Production images for an episode, priced in credits: a location's plate (for a location with no photo, drawn from its description), a scene image, a reel's storyboard sheet, or frames for shots. Name everything in one call - it is one confirmation, which shows the writer the total and their balance before anything is spent. Nothing starts until they confirm, and nothing can be undone after.",
  toolset: 'production',
  minimumRole: ROLE.paidGeneration,
  mode: 'paid',
  input: z.object({ episode: EpisodeNumber, images: z.array(ImageRequest).min(1).max(40) }),
  label: (input) => `Pricing ${String(input.images.length)} ${input.images.length === 1 ? 'image' : 'images'}`,
  prepare: async (ctx, input): Promise<Prepared<ImagesArgs>> => {
    const gate = await episodeGateFor(ctx, input.episode)
    if (typeof gate === 'string') return { ok: false, message: gate }
    const priced = await priceImages(gate, input.images)
    if (typeof priced === 'string') return { ok: false, message: priced }
    if (priced.problems.length > 0) return { ok: false, message: `Some of these cannot be drawn: ${priced.problems.join(' ')}` }
    const off = priced.items.map((item) => connected(JOB_OF[item.kind])).find((problem) => problem !== null)
    if (off !== undefined && off !== null) return { ok: false, message: off.message }
    return { ok: true, args: { episode: gate.episode.slug, items: [...priced.items] }, cost: totalOf(priced.items) }
  },
  executor: {
    args: ImagesArgsSchema,
    describe: (args) => describeImages(args.items),
    target: () => ({ type: 'generation', id: null }),
    capture: () => Promise.resolve(null),
    run: (ctx, args) => launchAll(ctx, args.episode, args.items.map((item) => ({ label: item.label, cost: item.cost, start: startImage(item) }))),
    preview: (_ctx, args) =>
      Promise.resolve({
        changes: args.items.map((item) => ({ field: item.label, before: null, after: credits(item.cost) })),
        open: { route: 'production' },
      }),
  },
})

// ---------------------------------------------------------------------------
// shoot_reel
// ---------------------------------------------------------------------------

export const ShootArgsSchema = z.object({
  episode: z.string(),
  reels: z.array(z.object({ reelId: z.uuid(), label: z.string(), cost: z.int().min(0) })).min(1),
  /** The episode's settings are not locked yet: this shoot's first success locks them. */
  locks: z.boolean(),
})

export type ShootArgs = z.infer<typeof ShootArgsSchema>

export const describeShoot = (args: Pick<ShootArgs, 'reels' | 'locks'>): string =>
  `Shoot ${String(args.reels.length)} ${args.reels.length === 1 ? 'reel' : 'reels'} for ${credits(totalOf(args.reels))}: ${args.reels.map((reel) => reel.label).join('; ')}${args.locks ? '. The first shoot locks the episode settings' : ''}`

/** Price and check a shoot against the episode as it is: each reel ready to shoot, or why it is not. */
export const priceShoot = async (gate: EpisodeGate, reelIds: readonly string[]): Promise<{ readonly args: ShootArgs; readonly problems: readonly string[] } | string> => {
  const g = await ground(gate)
  if (isFailure(g)) return g.message
  const live = new Set<string>((await listLiveGenerations(gate.scope, gate.episode.id)).map((generation) => generation.targetId))
  const reels: ShootArgs['reels'][number][] = []
  const problems: string[] = []
  for (const reelId of new Set(reelIds)) {
    const found = g.scenes.flatMap((scene) => scene.reels.map((reel) => ({ scene, reel }))).find(({ reel }) => reel.id === reelId)
    if (found === undefined) {
      problems.push('A reel is not in this episode.')
      continue
    }
    const label = reelLabel(found.scene, found.reel)
    const readiness = readinessOf(found.scene, found.reel)
    if (live.has(found.reel.id)) problems.push(`${label} is already being worked on.`)
    else if (!readiness.canShoot) problems.push(`${label} is not ready: ${flagWords(readiness.failed)}.`)
    else reels.push({ reelId: found.reel.id, label, cost: GENERATION_COSTS.shoot_reel })
  }
  return { args: { episode: gate.episode.slug, reels, locks: g.settings.lockedAt === null }, problems }
}

export const shootReelTool = defineWriteTool({
  name: 'shoot_reel',
  description:
    'Shoot Production reels into video clips, priced in credits per reel. A reel must be ready: a full shotlist, a storyboard sheet, a scene image with its location plate, and a look for everyone in it. Name every reel in one call - one confirmation, showing the total and the balance. The first shoot locks the episode settings. Nothing can be undone after.',
  toolset: 'production',
  minimumRole: ROLE.paidGeneration,
  mode: 'paid',
  input: z.object({ episode: EpisodeNumber, reelIds: z.array(ReelIdSchema).min(1).max(20) }),
  label: (input) => `Pricing ${String(input.reelIds.length)} ${input.reelIds.length === 1 ? 'shoot' : 'shoots'}`,
  prepare: async (ctx, input): Promise<Prepared<ShootArgs>> => {
    const gate = await episodeGateFor(ctx, input.episode)
    if (typeof gate === 'string') return { ok: false, message: gate }
    const off = connected('shoot_reel')
    if (off !== null) return { ok: false, message: off.message }
    const priced = await priceShoot(gate, input.reelIds)
    if (typeof priced === 'string') return { ok: false, message: priced }
    if (priced.problems.length > 0) return { ok: false, message: `Some of these cannot be shot: ${priced.problems.join(' ')}` }
    return { ok: true, args: priced.args, cost: totalOf(priced.args.reels) }
  },
  executor: {
    args: ShootArgsSchema,
    describe: describeShoot,
    target: () => ({ type: 'generation', id: null }),
    capture: () => Promise.resolve(null),
    run: (ctx, args) => launchAll(ctx, args.episode, args.reels.map((reel) => ({ label: reel.label, cost: reel.cost, start: async (gate) => single(await shootReelWith(gate, reel.reelId)) }))),
    preview: (_ctx, args) =>
      Promise.resolve({
        changes: [
          ...args.reels.map((reel) => ({ field: reel.label, before: null, after: credits(reel.cost) })),
          ...(args.locks ? [{ field: 'Episode settings', before: 'editable', after: 'locked at the first shoot' }] : []),
        ],
        open: { route: 'production' },
      }),
  },
})

export const PAID_WRITE_TOOLS: readonly WriteTool[] = [generateImagesTool, shootReelTool]
