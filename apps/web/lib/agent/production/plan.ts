import type { ProductionFrameState, ProductionScene, ReadinessFlag, Reel } from '@folio/contracts'
import { GENERATION_COSTS } from '@folio/contracts'
import { z } from 'zod'

import { readinessOf } from '../../production/derive'

/**
 * What an episode still needs drawn, and what it costs - roadmap task 5.1.
 *
 * Pure, over Production's composed read model (`ProductionScene`, the same
 * one the route draws). The production pipeline (`pipeline.ts`) plans each
 * round with it, and the paid tools (`tools/writes-paid.ts`) price and check a
 * call with it, so the table the writer confirms and the work the executor
 * starts are one list. Every number is `GENERATION_COSTS` - named before it is
 * spent (AGENTS.md, *Jobs, credits and cost*), never the model's.
 */

/** One image a paid operation starts. `cost` is its credits, the frames' already multiplied. */
export const ImageItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plate'), locationId: z.uuid(), label: z.string(), cost: z.int().min(0) }),
  z.object({ kind: z.literal('look'), characterId: z.uuid(), label: z.string(), cost: z.int().min(0) }),
  z.object({ kind: z.literal('scene_image'), sceneId: z.uuid(), label: z.string(), cost: z.int().min(0) }),
  z.object({ kind: z.literal('sheet'), reelId: z.uuid(), label: z.string(), cost: z.int().min(0) }),
  z.object({ kind: z.literal('frames'), reelId: z.uuid(), shotIds: z.array(z.uuid()).min(1).max(50), label: z.string(), cost: z.int().min(0) }),
])

export type ImageItem = z.infer<typeof ImageItemSchema>

export type ImageKind = ImageItem['kind']

/** The order the images are drawn in: a plate and a look are what the rest are drawn against. */
export const IMAGE_ORDER: readonly ImageKind[] = ['plate', 'look', 'scene_image', 'sheet', 'frames']

/** A frame is drawn again from these; a drawn, uploaded, blocked or live one is left. */
const FRAME_TO_DRAW: readonly ProductionFrameState[] = ['empty', 'ready', 'stale', 'failed', 'cancelled']

const sceneLabel = (scene: Pick<ProductionScene, 'number'>): string => `scene ${String(scene.number)}`

/** A reel as the writer reads it: its name and its scene. */
export const reelLabel = (scene: Pick<ProductionScene, 'number'>, reel: Pick<Reel, 'name'>): string => `${reel.name}, ${sceneLabel(scene)}`

/** The shots a frame can be drawn for: accepted, described, not drawn and not drawing. */
export const framesToDraw = (reel: Pick<Reel, 'shots'>, live: ReadonlySet<string>): readonly string[] =>
  reel.shots.filter((shot) => !shot.proposed && shot.description.trim().length > 0 && FRAME_TO_DRAW.includes(shot.frameState) && !live.has(shot.id)).map((shot) => shot.id)

export type PlanInput = {
  readonly scenes: readonly ProductionScene[]
  /** Target ids with a queued or running generation - never planned twice. */
  readonly live: ReadonlySet<string>
  /** Plates are drawn only when the writer said so at the plates checkpoint. */
  readonly plates: boolean
  /** Character looks for the cast with no portrait - what a shoot needs of them (roadmap task 5.2). */
  readonly looks: boolean
}

/**
 * Every image the episode's reels still need before they can be shot, in
 * drawing order. Only scenes with a reel count - the pipeline shoots reels, and
 * a scene with none is not being made. A location with no record (a slugline
 * nothing resolved) cannot have a plate; `missingPlates` names those.
 */
export const imagesToDraw = (input: PlanInput): readonly ImageItem[] => {
  const scenes = input.scenes.filter((scene) => scene.reels.length > 0)
  const items: ImageItem[] = []

  if (input.plates) {
    const seen = new Set<string>()
    for (const scene of scenes) {
      if (scene.plateReady || scene.locationId === null || seen.has(scene.locationId) || input.live.has(scene.locationId)) continue
      seen.add(scene.locationId)
      items.push({ kind: 'plate', locationId: scene.locationId, label: `The plate for ${scene.locationName ?? scene.set}`, cost: GENERATION_COSTS.location_plate })
    }
  }

  if (input.looks) {
    const seen = new Set<string>()
    for (const scene of scenes) {
      for (const person of scene.cast) {
        if (person.appearanceReady || seen.has(person.id) || input.live.has(person.id)) continue
        seen.add(person.id)
        items.push({ kind: 'look', characterId: person.id, label: `The look for ${person.name}`, cost: GENERATION_COSTS.character_look })
      }
    }
  }

  for (const scene of scenes) {
    const still = scene.stillState === 'drawn' || scene.stillState === 'uploaded'
    if (still || input.live.has(scene.sceneNodeId)) continue
    items.push({ kind: 'scene_image', sceneId: scene.sceneNodeId, label: `The scene image for ${sceneLabel(scene)}`, cost: GENERATION_COSTS.scene_image })
  }

  for (const scene of scenes) {
    for (const reel of scene.reels) {
      // A sheet is drawn from a finished shotlist; a reel already drawing is left.
      if (reel.sheet?.state === 'done' || input.live.has(reel.id) || !readinessOf(scene, reel).shotlist) continue
      items.push({ kind: 'sheet', reelId: reel.id, label: `The storyboard sheet for ${reelLabel(scene, reel)}`, cost: GENERATION_COSTS.storyboard_sheet })
    }
  }

  for (const scene of scenes) {
    for (const reel of scene.reels) {
      const shots = framesToDraw(reel, input.live)
      if (shots.length === 0) continue
      items.push({
        kind: 'frames',
        reelId: reel.id,
        shotIds: [...shots],
        label: `${String(shots.length)} ${shots.length === 1 ? 'frame' : 'frames'} for ${reelLabel(scene, reel)}`,
        cost: GENERATION_COSTS.shot_frame * shots.length,
      })
    }
  }
  return items
}

/** The locations a shoot will need a plate for: in a scene with a reel, and without a photo. */
export const missingPlates = (scenes: readonly ProductionScene[]): readonly { readonly id: string | null; readonly name: string }[] => {
  const seen = new Set<string>()
  const out: { readonly id: string | null; readonly name: string }[] = []
  for (const scene of scenes) {
    if (scene.reels.length === 0 || scene.plateReady) continue
    const name = scene.locationName ?? scene.set
    const key = scene.locationId ?? `set:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: scene.locationId, name })
  }
  return out
}

/** One line of the cost table: a kind of image, how many, at what each, for how much. */
export type CostLine = { readonly label: string; readonly count: number; readonly each: number; readonly total: number }

const KIND_LABEL: Readonly<Record<ImageKind | 'shoot', readonly [string, string]>> = {
  plate: ['location plate', 'location plates'],
  look: ['character look', 'character looks'],
  scene_image: ['scene image', 'scene images'],
  sheet: ['storyboard sheet', 'storyboard sheets'],
  frames: ['frame', 'frames'],
  shoot: ['reel shoot', 'reel shoots'],
}

const EACH: Readonly<Record<ImageKind | 'shoot', number>> = {
  plate: GENERATION_COSTS.location_plate,
  look: GENERATION_COSTS.character_look,
  scene_image: GENERATION_COSTS.scene_image,
  sheet: GENERATION_COSTS.storyboard_sheet,
  frames: GENERATION_COSTS.shot_frame,
  shoot: GENERATION_COSTS.shoot_reel,
}

/**
 * The cost table: the images grouped by kind, in drawing order, and the
 * shoots the reels will need after them - `shoots` reels at the reel price,
 * listed so the writer sees the whole bill before the first image is spent,
 * though the shoots are confirmed on their own.
 */
export const costTable = (items: readonly ImageItem[], shoots: number): readonly CostLine[] => {
  const lines: CostLine[] = []
  for (const kind of IMAGE_ORDER) {
    const count = items.filter((item) => item.kind === kind).reduce((total, item) => total + (item.kind === 'frames' ? item.shotIds.length : 1), 0)
    if (count === 0) continue
    lines.push({ label: KIND_LABEL[kind][count === 1 ? 0 : 1], count, each: EACH[kind], total: count * EACH[kind] })
  }
  if (shoots > 0) lines.push({ label: KIND_LABEL.shoot[shoots === 1 ? 0 : 1], count: shoots, each: EACH.shoot, total: shoots * EACH.shoot })
  return lines
}

export const totalOf = (items: readonly { readonly cost: number }[]): number => items.reduce((total, item) => total + item.cost, 0)

/** `1,125 credits` - how a cost is written in the chat and on the card. */
export const credits = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'credit' : 'credits'}`

/** The table as the run's chat prints it: one line a kind, then the total and the balance it comes out of. */
export const costTableText = (lines: readonly CostLine[], balance: number): string => {
  const body = lines.map((line) => `- ${String(line.count)} ${line.label} at ${String(line.each)} each: ${credits(line.total)}`)
  const total = lines.reduce((sum, line) => sum + line.total, 0)
  return [...body, `Total: ${credits(total)}. You have ${credits(balance)} available.`].join('\n')
}

/** A reel the pipeline can shoot, or one it cannot yet and why. */
export type ShootPlan = {
  readonly ready: readonly { readonly reelId: string; readonly label: string }[]
  readonly waiting: readonly { readonly reelId: string; readonly label: string; readonly failed: readonly ReadinessFlag[] }[]
  /** Reels with a rendered clip - done. */
  readonly shot: number
}

const FLAG_WORDS: Readonly<Record<ReadinessFlag, string>> = {
  shotlist: 'the shotlist does not fill the clip',
  sheet: 'no storyboard sheet',
  scene_image: 'no scene image or no location plate',
  characters: 'a cast member has no look',
}

export const flagWords = (flags: readonly ReadinessFlag[]): string => flags.map((flag) => FLAG_WORDS[flag]).join(', ')

/** Every reel of the episode: ready to shoot, still missing something, or shot already. Live shoots are neither. */
export const shootPlan = (scenes: readonly ProductionScene[], live: ReadonlySet<string>): ShootPlan => {
  const ready: { reelId: string; label: string }[] = []
  const waiting: { reelId: string; label: string; failed: readonly ReadinessFlag[] }[] = []
  let shot = 0
  for (const scene of scenes) {
    for (const reel of scene.reels) {
      if (reel.clip !== null && reel.clip.state === 'rendered') {
        shot += 1
        continue
      }
      if (live.has(reel.id)) continue
      const readiness = readinessOf(scene, reel)
      if (readiness.canShoot) ready.push({ reelId: reel.id, label: reelLabel(scene, reel) })
      else waiting.push({ reelId: reel.id, label: reelLabel(scene, reel), failed: readiness.failed })
    }
  }
  return { ready, waiting, shot }
}
