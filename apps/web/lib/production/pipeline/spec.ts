import type { ArtStyle, EpisodeSettings, GenerationJob, ProductionScene, Reel, ReelShot } from '@folio/contracts'
import { MODEL_REGISTRY } from '@folio/contracts'
import { createHash } from 'node:crypto'
import { z } from 'zod'

import { cameraString, sheetCameraNote, sheetHeading } from '../camera'
import { shotClocks } from '../derive'
import type { ImageSpec } from './gemini'

/**
 * The provider-neutral spec every generation carries (AGENTS.md, Jobs,
 * credits and cost): the assembled prompt, role-tagged reference inputs,
 * the film-settings snapshot, and a `source_hash` over the inputs so an
 * output whose inputs moved is known to be stale. Assembled here, stored
 * on the `generations` row as `prompt` / `settings_snapshot`, and handed
 * to the runner; the provider client (`gemini.ts`) never sees a row.
 *
 * Consistency is reference discipline: the Art Style prefix, the cast's
 * portraits (the kept Look, by the client's ruling) and the location's
 * photo (the plate) go into every image and video prompt, as
 * role-tagged references the model receives beside the text.
 */

export type ReferenceRole = 'character' | 'location' | 'scene_still' | 'shot_frame' | 'reference'

export type SpecReference = {
  readonly role: ReferenceRole
  readonly label: string
  readonly url: string
}

export type SettingsSnapshot = Pick<EpisodeSettings, 'aspectRatio' | 'productionType' | 'cameraStyle' | 'pacing' | 'lighting'> & {
  readonly artStyle: string
}

export type GenerationSpec = {
  readonly job: GenerationJob
  readonly prompt: string
  readonly references: readonly SpecReference[]
  readonly settings: SettingsSnapshot
  /** The provider's aspect string: `16:9`, `9:16`, `21:9`. */
  readonly aspect: '16:9' | '9:16' | '21:9'
  /** Seconds, for a clip. */
  readonly durationS: number | null
  readonly sourceHash: string
  /** The registry's model, or null for a job no model runs. */
  readonly route: string | null
}

const ASPECT: Readonly<Record<EpisodeSettings['aspectRatio'], GenerationSpec['aspect']>> = {
  '16:9 landscape': '16:9',
  '9:16 portrait': '9:16',
  '2.39:1 scope': '21:9',
}

export const snapshotOf = (settings: EpisodeSettings, artStyle: ArtStyle): SettingsSnapshot => ({
  aspectRatio: settings.aspectRatio,
  productionType: settings.productionType,
  cameraStyle: settings.cameraStyle,
  pacing: settings.pacing,
  lighting: settings.lighting,
  artStyle: artStyle.name,
})

const hashOf = (inputs: unknown): string => createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 32)

/** The Art Style prefix every image and video prompt opens with. */
const stylePrefix = (snapshot: SettingsSnapshot, artStyle: ArtStyle): string =>
  `Art style: ${artStyle.name} (${artStyle.era}; reference films ${artStyle.referenceFilms.join(', ')}). ${artStyle.description} ` +
  `Production type ${snapshot.productionType}, camera style ${snapshot.cameraStyle}, pacing ${snapshot.pacing}, lighting ${snapshot.lighting}. ` +
  `Frame format ${snapshot.aspectRatio}.`

const sceneLine = (scene: ProductionScene): string =>
  `Scene ${String(scene.number)}: ${scene.heading}. ${scene.logline}`

const castLine = (scene: ProductionScene): string =>
  scene.cast.length === 0 ? '' : `Cast: ${scene.cast.map((member) => member.name).join(', ')}.`

const castReferences = (scene: ProductionScene): readonly SpecReference[] =>
  scene.cast.flatMap((member) => (member.portraitUrl === null ? [] : [{ role: 'character' as const, label: member.name, url: member.portraitUrl }]))

const stillReference = (scene: ProductionScene): readonly SpecReference[] =>
  scene.still?.url === null || scene.still?.url === undefined ? [] : [{ role: 'scene_still', label: scene.locationName ?? scene.set, url: scene.still.url }]

const shotLine = (index: number, shot: ReelShot, clocks: ReturnType<typeof shotClocks>): string => {
  const clock = clocks.find((entry) => entry.shotId === shot.id)
  const when = clock === undefined ? '' : ` (${String(clock.from)}–${String(clock.to)}s)`
  const dialogue = shot.dialogue === null ? '' : ` Dialogue: ${shot.dialogue}`
  return `${String(index + 1)}. ${cameraString(shot)}${when}: ${shot.description}${dialogue}`
}

const build = (
  job: GenerationJob,
  prompt: string,
  references: readonly SpecReference[],
  settings: SettingsSnapshot,
  aspect: GenerationSpec['aspect'],
  durationS: number | null,
  inputs: unknown,
): GenerationSpec => ({
  job,
  prompt,
  references,
  settings,
  aspect,
  durationS,
  sourceHash: hashOf({ job, prompt, references: references.map((r) => r.url), settings, aspect, durationS, inputs }),
  route: MODEL_REGISTRY[job]?.model ?? null,
})

/** §3.4: one image - a top-down blocking plate plus a row per shot. */
export const sheetSpec = (scene: ProductionScene, reel: Reel, settings: EpisodeSettings, artStyle: ArtStyle): GenerationSpec => {
  const snapshot = snapshotOf(settings, artStyle)
  const clocks = shotClocks(reel)
  const prompt = [
    stylePrefix(snapshot, artStyle),
    `Draw ONE storyboard sheet as a single image for ${reel.name} of ${sceneLine(scene)} ${castLine(scene)}`,
    `Layout: a top-down blocking plate at the top showing the set, the cast's positions and the camera paths, then one row per shot below it - each row a drawn frame on the left (55%) and a monospace camera note on the right (45%) reading the heading, the camera and the time range.`,
    `Shots:`,
    ...reel.shots.map((shot, index) => `${shotLine(index, shot, clocks)} - note: "${sheetHeading(index, shot)} / ${sheetCameraNote(shot)}"`),
    `Clip length ${String(reel.clipLengthS)} s. Pencil-and-wash storyboard look, consistent characters across rows, no text other than the notes.`,
  ].join('\n')
  return build('storyboard_sheet', prompt, [...castReferences(scene), ...stillReference(scene)], snapshot, ASPECT[settings.aspectRatio], null, {
    reel: reel.id,
    shots: reel.shots.map((shot) => [shot.id, shot.description, shot.durationS, cameraString(shot)]),
  })
}

/** §3.6: one still per scene. */
export const sceneImageSpec = (scene: ProductionScene, settings: EpisodeSettings, artStyle: ArtStyle): GenerationSpec => {
  const snapshot = snapshotOf(settings, artStyle)
  const prompt = [
    stylePrefix(snapshot, artStyle),
    `A single establishing still for ${sceneLine(scene)} ${castLine(scene)}`,
    `Location: ${scene.locationName ?? scene.set}${scene.intExt === null ? '' : ` (${scene.intExt})`}${scene.timeOfDay === null ? '' : `, ${scene.timeOfDay.toLowerCase()}`}.`,
    `Cinematic photograph, the location as the subject, no text, no watermark.`,
  ].join('\n')
  return build('scene_image', prompt, castReferences(scene), snapshot, ASPECT[settings.aspectRatio], null, {
    scene: scene.sceneNodeId,
    heading: scene.heading,
    logline: scene.logline,
  })
}

/** A per-shot frame - the bulk bar's `✦ Generate n frames`. */
export const frameSpec = (scene: ProductionScene, reel: Reel, shot: ReelShot, settings: EpisodeSettings, artStyle: ArtStyle): GenerationSpec => {
  const snapshot = snapshotOf(settings, artStyle)
  const index = reel.shots.findIndex((candidate) => candidate.id === shot.id)
  const prompt = [
    stylePrefix(snapshot, artStyle),
    `One frame for shot ${String(index + 1)} of ${reel.name}, ${sceneLine(scene)} ${castLine(scene)}`,
    `Camera: ${cameraString(shot)}.`,
    `Action: ${shot.description}${shot.dialogue === null ? '' : ` Dialogue: ${shot.dialogue}`}`,
    `Cinematic frame exactly as the camera sees it, no text, no watermark.`,
  ].join('\n')
  const references = [
    ...castReferences(scene).filter((reference) => shot.characters.length === 0 || scene.cast.some((member) => member.name === reference.label && shot.characters.some((c) => c.characterId === member.id))),
    ...stillReference(scene),
    ...shot.references.flatMap((asset) => (asset.url === null ? [] : [{ role: 'reference' as const, label: 'reference', url: asset.url }])),
  ]
  return build('shot_frame', prompt, references, snapshot, ASPECT[settings.aspectRatio], null, {
    shot: shot.id,
    description: shot.description,
    camera: cameraString(shot),
  })
}

/** `✦ AI Shotlist`: the scene's lines in, a shotlist out as JSON. */
export const shotlistSpec = (scene: ProductionScene, reel: Reel, sceneText: string, settings: EpisodeSettings, artStyle: ArtStyle): GenerationSpec => {
  const snapshot = snapshotOf(settings, artStyle)
  const prompt = [
    `You are a director breaking a screenplay scene into a shotlist for ${reel.name}, a clip of exactly ${String(reel.clipLengthS)} seconds.`,
    `Film: ${snapshot.productionType}, camera style ${snapshot.cameraStyle}, pacing ${snapshot.pacing}, lighting ${snapshot.lighting}, art style ${artStyle.name}.`,
    `Scene ${String(scene.number)}: ${scene.heading}. ${castLine(scene)}`,
    `The scene's lines:`,
    sceneText,
    `Return JSON only: an array of 2 to 6 shots whose durations sum to exactly ${String(reel.clipLengthS)}. Each shot: {"shotType": one of ["Wide angle","Medium","Close-up","Over","Point","Two shot","Tracking","Dutch"], "cameraAngle": short text such as "Eye level" / "Low" / "High", "cameraMotion": one of ["Still","Pan","Zoom","Rotate","Tilt","Follow","Track","Dolly","Handheld","Crane"], "lens": e.g. "35mm T2.0", "durationS": integer seconds, "description": one or two sentences naming characters as @Name exactly as they appear in the cast list, quoting any spoken line in double quotes}.`,
  ].join('\n')
  return build('ai_shotlist', prompt, [], snapshot, ASPECT[settings.aspectRatio], null, { reel: reel.id, sceneText })
}

/** §3.7 `▶ Start shooting`: the clip. The sheet and every reference go in. */
export const shootSpec = (scene: ProductionScene, reel: Reel, settings: EpisodeSettings, artStyle: ArtStyle): GenerationSpec => {
  const snapshot = snapshotOf(settings, artStyle)
  const clocks = shotClocks(reel)
  const prompt = [
    stylePrefix(snapshot, artStyle),
    `A ${String(reel.clipLengthS)}-second clip, ${reel.name} of ${sceneLine(scene)} ${castLine(scene)}`,
    `Continuity ${reel.continuity}. Cut the shots in order:`,
    ...reel.shots.map((shot, index) => shotLine(index, shot, clocks)),
    `Photoreal cinematic footage matching the storyboard sheet and the scene still, natural sound, no text, no watermark.`,
  ].join('\n')
  const references = [
    ...castReferences(scene),
    ...stillReference(scene),
    ...(reel.sheet?.asset?.url === null || reel.sheet?.asset?.url === undefined ? [] : [{ role: 'reference' as const, label: 'storyboard sheet', url: reel.sheet.asset.url }]),
  ]
  return build('shoot_reel', prompt, references, snapshot, ASPECT[settings.aspectRatio], reel.clipLengthS, {
    reel: reel.id,
    shots: reel.shots.map((shot) => [shot.id, shot.description, shot.durationS, cameraString(shot)]),
    sheet: reel.sheet?.asset?.id ?? null,
  })
}

/** What a location plate is drawn from: the location record's own words. */
export type PlateInput = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly address: string | null
}

/**
 * A location's plate (roadmap task 5.1): the establishing photograph a shoot
 * uses as the set, drawn from the location's own description when the writer
 * has no photo to upload (the client's ruling, 2026-09-24). Stored as the
 * location's photo, it is the plate every later image and clip is given, so it
 * carries the Art Style prefix like them and nothing of any one scene: no
 * cast, no action, the place alone.
 */
export const locationPlateSpec = (location: PlateInput, settings: EpisodeSettings, artStyle: ArtStyle): GenerationSpec => {
  const snapshot = snapshotOf(settings, artStyle)
  const described = location.description === null || location.description.trim() === '' ? 'Draw it as its name suggests.' : location.description.trim()
  const prompt = [
    stylePrefix(snapshot, artStyle),
    `A location plate for ${location.name}: one establishing photograph of the place itself, empty of people, as a production would photograph it on a recce.`,
    `The place: ${described}${location.address === null || location.address.trim() === '' ? '' : ` Where: ${location.address.trim()}.`}`,
    `Cinematic photograph, the set as the subject, no people, no text, no watermark.`,
  ].join('\n')
  return build('location_plate', prompt, [], snapshot, ASPECT[settings.aspectRatio], null, {
    location: location.id,
    name: location.name,
    description: location.description,
    address: location.address,
  })
}

// ---------------------------------------------------------------------------
// On the worker (roadmap task 4.3)
// ---------------------------------------------------------------------------

const StoredPromptSchema = z.object({
  text: z.string(),
  references: z.array(z.object({ role: z.enum(['character', 'location', 'scene_still', 'shot_frame', 'reference']), label: z.string(), url: z.string() })),
  aspect: z.enum(['16:9', '9:16', '21:9']),
  durationS: z.number().nullable(),
})

/**
 * The spec a generation was queued with, read back off its row - `prompt`
 * (text, references, aspect, duration), `settings_snapshot`, `route` and
 * `source_hash` are exactly what `createGeneration` stored from it. The worker
 * runs what the writer was quoted for, not a spec re-assembled from whatever
 * the records say by the time the job is claimed. `null`: the row does not
 * read, and the generation fails rather than runs something else.
 */
export const specFromRun = (row: {
  readonly job: GenerationJob
  readonly prompt: unknown
  readonly settingsSnapshot: unknown
  readonly route: string | null
  readonly sourceHash: string | null
}): GenerationSpec | null => {
  const prompt = StoredPromptSchema.safeParse(row.prompt)
  if (!prompt.success || row.settingsSnapshot === null || typeof row.settingsSnapshot !== 'object') return null
  return {
    job: row.job,
    prompt: prompt.data.text,
    references: prompt.data.references,
    settings: row.settingsSnapshot as SettingsSnapshot,
    aspect: prompt.data.aspect,
    durationS: prompt.data.durationS,
    sourceHash: row.sourceHash ?? '',
    route: row.route,
  }
}

/** What a Storyboard frame is drawn from: the shot as its card reads, and the scene it is in. */
export type StoryboardFrameInput = {
  readonly heading: string
  /** The shot's camera, as the board prints it: `MS · eye level · static · 35mm`. */
  readonly camera: string
  /** The description with every `@mention` printed as the record's name. */
  readonly description: string
  /** Portraits of the characters the description mentions - the kept Look, as Production's frames use it. */
  readonly cast: readonly { readonly name: string; readonly portraitUrl: string | null }[]
}

/**
 * A Storyboard frame (`frame_generation` jobs, roadmap task 4.3), drawn with
 * the `shot_frame` model from `MODEL_REGISTRY`. The Storyboard has no episode
 * settings and no art style - those are Production's - so the frame is a
 * plain storyboard drawing at 16:9, with the mentioned characters' portraits
 * as references for consistency.
 */
export const storyboardFrameSpec = (input: StoryboardFrameInput): ImageSpec & { readonly route: string | null } => ({
  prompt: [
    `One storyboard frame, pencil-and-wash storyboard look, exactly as the camera sees it. No text, no watermark, no panel border.`,
    `Scene: ${input.heading}.`,
    `Camera: ${input.camera}.`,
    `Action: ${input.description.trim().length === 0 ? 'the scene as its heading describes it' : input.description}`,
  ].join('\n'),
  references: input.cast.flatMap((member) => (member.portraitUrl === null ? [] : [{ role: 'character' as const, label: member.name, url: member.portraitUrl }])),
  aspect: '16:9',
  route: MODEL_REGISTRY.shot_frame?.model ?? null,
})
