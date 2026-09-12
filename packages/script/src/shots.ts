import { canonicalKey } from './alias'
import type { SluglineReading } from './entities'
import { readCue } from './generated-text'
import type { CharacterId, LocationId } from './ids'
import { mention, text } from './inline'
import type { InlineContent, InlineRun } from './inline'
import type { ScreenplayNode } from './node'
import { isCommentNode } from './stream'

/**
 * Shots. The vocabulary a shot is described in, and a first shot list read
 * off a scene's text.
 *
 * ## What a shot is, and is not
 *
 * A scene does not say how it is shot. The Storyboard brief: "Break each
 * scene into shots, and give each shot a frame." A shot is therefore not a
 * node - it is authored data that hangs off a scene by the heading node's id,
 * the same way a synopsis does - and this file owns only the part of it that
 * is a function of the node list: the closed vocabularies below, and
 * `proposeShots`, which is "propose shots for this scene" as the brief
 * words it, "returning a list you accept or edit".
 *
 * Nothing here is stored. A shot's number (`01-03`) is its scene's number
 * and its ordinal among the scene's shots, computed at render; the
 * vocabularies are enums at the boundary; the proposal is a value the
 * writer accepts into rows or discards.
 *
 * ## The proposer is deterministic, and says so
 *
 * The brief's interaction is a proposal. A model would make one; this
 * package cannot call one (no I/O, no dependencies, and AGENTS.md's parity
 * rule wants agent output to reach the writer as a proposal anchored to
 * real ids). What is here is a **rule-based** first pass over the scene's
 * own text - establishing, two-shot, one medium close-up per speaker, a
 * closing wide when the scene ends on action - with every character
 * reference emitted as a structural `@mention` to the record the cue
 * resolves to through the alias table. It never invents a person: a cue
 * that resolves to no record is described by its text, and the writer
 * binds it on the Characters route as they would anywhere else.
 *
 * Same input, same output, every time - which is what makes it safe to run
 * on a request and what a later agent-backed proposer has to keep: the
 * *shape* of a proposal is this file's, whoever fills it in.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Shot sizes, wide to tight, plus the two that are not a size but are asked
 * for as one on every shot list: over-the-shoulder and the insert.
 */
export const SHOT_SIZES = ['ews', 'ws', 'mws', 'ms', 'mcu', 'cu', 'ecu', 'ots', 'insert'] as const

export type ShotSize = (typeof SHOT_SIZES)[number]

export const SHOT_SIZE_LABEL: Readonly<Record<ShotSize, { readonly name: string; readonly short: string }>> = {
  ews: { name: 'Extreme wide shot', short: 'EWS' },
  ws: { name: 'Wide shot', short: 'WS' },
  mws: { name: 'Medium wide shot', short: 'MWS' },
  ms: { name: 'Medium shot', short: 'MS' },
  mcu: { name: 'Medium close-up', short: 'MCU' },
  cu: { name: 'Close-up', short: 'CU' },
  ecu: { name: 'Extreme close-up', short: 'ECU' },
  ots: { name: 'Over the shoulder', short: 'OTS' },
  insert: { name: 'Insert', short: 'INS' },
}

export const SHOT_MOVEMENTS = [
  'static',
  'handheld',
  'pan',
  'tilt',
  'dolly',
  'track',
  'crane',
  'steadicam',
  'zoom',
] as const

export type ShotMovement = (typeof SHOT_MOVEMENTS)[number]

export const SHOT_MOVEMENT_LABEL: Readonly<Record<ShotMovement, string>> = {
  static: 'Static',
  handheld: 'Handheld',
  pan: 'Pan',
  tilt: 'Tilt',
  dolly: 'Dolly',
  track: 'Track',
  crane: 'Crane',
  steadicam: 'Steadicam',
  zoom: 'Zoom',
}

export const CAMERA_ANGLES = ['eye_level', 'low', 'high', 'dutch', 'overhead', 'pov'] as const

export type CameraAngle = (typeof CAMERA_ANGLES)[number]

export const CAMERA_ANGLE_LABEL: Readonly<Record<CameraAngle, string>> = {
  eye_level: 'Eye level',
  low: 'Low angle',
  high: 'High angle',
  dutch: 'Dutch',
  overhead: 'Overhead',
  pov: 'POV',
}

export const isShotSize = (value: string): value is ShotSize =>
  (SHOT_SIZES as readonly string[]).includes(value)

export const isShotMovement = (value: string): value is ShotMovement =>
  (SHOT_MOVEMENTS as readonly string[]).includes(value)

export const isCameraAngle = (value: string): value is CameraAngle =>
  (CAMERA_ANGLES as readonly string[]).includes(value)

/**
 * What a shot says about itself. Every field the brief lists except order,
 * which is the list's, not the shot's.
 *
 * `lensMm` and `durationSeconds` are nullable because a shot list is written
 * before either is known, and `—` is the honest reading of an unset lens.
 * `description` is inline content, not a string, for the reason a node's
 * text is: an `@mention` in it is a reference to a record id and survives
 * a rename.
 */
export type ShotSpec = {
  readonly size: ShotSize
  readonly movement: ShotMovement
  readonly angle: CameraAngle
  readonly lensMm: number | null
  readonly durationSeconds: number | null
  readonly description: InlineContent
}

/** `01-03`: scene `01`, third shot. Both zero-padded to two, as the bundle prints them. */
export const shotLabel = (sceneNumber: number, ordinal: number): string =>
  `${String(sceneNumber).padStart(2, '0')}-${String(ordinal).padStart(2, '0')}`

// ---------------------------------------------------------------------------
// The proposer
// ---------------------------------------------------------------------------

export type ProposeShotsInput = {
  /** The heading's reading, or `null` when the scene's heading did not read. */
  readonly reading: SluglineReading | null
  /** The scene's nodes, heading first, in document order. Comments are skipped. */
  readonly nodes: readonly ScreenplayNode[]
  /**
   * The alias table's bound half: `canonicalKey(cue)` to the record it is
   * bound to. The same map `derive` resolves cues through - a cue that is
   * not in it is described as text, never minted here.
   */
  readonly boundCues: ReadonlyMap<string, CharacterId>
  /** The record the heading resolved to, for the establishing shot's mention. */
  readonly locationId: LocationId | null
}

/** How much of an action line a description quotes. Enough to place the shot, not the whole paragraph. */
const EXCERPT_LENGTH = 120

/** How many speakers get a medium close-up before the list stops proposing. */
const MAX_SPEAKER_SHOTS = 4

const plainText = (content: InlineContent): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : ''))
    .join('')
    .trim()

/** Cut at a word boundary, with an ellipsis; a short line is returned whole. */
export const excerpt = (value: string, length = EXCERPT_LENGTH): string => {
  const trimmed = value.trim().replace(/\s+/gu, ' ')
  if (trimmed.length <= length) return trimmed
  const cut = trimmed.slice(0, length)
  const space = cut.lastIndexOf(' ')
  return `${(space > length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

type Speaker = {
  readonly key: string
  readonly name: string
  readonly id: CharacterId | null
  readonly firstLine: string | null
}

/** A speaker as a run: a mention when the cue is bound, the cue's own text when it is not. */
const speakerRun = (speaker: Speaker): InlineRun =>
  speaker.id === null ? text(speaker.name) : mention({ entity: 'character', id: speaker.id })

const join = (...parts: readonly (InlineRun | readonly InlineRun[])[]): InlineContent =>
  parts.flatMap((part) => (Array.isArray(part) ? part : [part as InlineRun]))

/**
 * A first shot list for one scene.
 *
 * The rules, in the order the shots come out:
 *
 *   1. **Establishing wide.** Always, even for a scene with no text under
 *      its heading: `WS`, static, 24mm, eye level. Names the location as a
 *      mention when the heading resolved to one, else as the heading's set
 *      text; carries the time of day and the first action line.
 *   2. **Two-shot.** When two or more people speak: `MS`, static, 35mm, on
 *      the first two speakers.
 *   3. **One medium close-up per speaker**, first-appearance order, at most
 *      four: `MCU`, static, 50mm, with the speaker's first line quoted.
 *   4. **Closing wide.** When the scene ends on action after dialogue: `WS`,
 *      static, 24mm, with that last action line.
 *
 * The heading node itself is not read for text - `reading` already is the
 * heading. Nodes of type `scene` after the first are demoted headings the
 * writer typed and are treated as action (`derive.ts`: "the nodes after a
 * demoted heading go on belonging to the scene they were in").
 */
export const proposeShots = (input: ProposeShotsInput): readonly ShotSpec[] => {
  const [, ...body] = input.nodes
  const renderable = body.filter((node) => !isCommentNode(node))

  const actions: string[] = []
  const speakers: Speaker[] = []
  const byKey = new Map<string, Speaker>()
  let awaitingLine: Speaker | null = null
  let lastWasAction = false

  for (const node of renderable) {
    switch (node.type) {
      case 'action':
      case 'scene':
      case 'subtitle': {
        const value = plainText(node.content)
        if (value !== '') actions.push(value)
        awaitingLine = null
        lastWasAction = value !== ''
        break
      }
      case 'character': {
        const reading = readCue(plainText(node.content))
        const key = canonicalKey(reading.name)
        if (key === '') {
          awaitingLine = null
          break
        }
        let speaker = byKey.get(key)
        if (speaker === undefined) {
          speaker = { key, name: reading.name, id: input.boundCues.get(key) ?? null, firstLine: null }
          byKey.set(key, speaker)
          speakers.push(speaker)
        }
        awaitingLine = speaker
        lastWasAction = false
        break
      }
      case 'dialogue': {
        if (awaitingLine !== null && awaitingLine.firstLine === null) {
          const value = plainText(node.content)
          if (value !== '') {
            const filled: Speaker = { ...awaitingLine, firstLine: value }
            byKey.set(filled.key, filled)
            const at = speakers.findIndex((entry) => entry.key === filled.key)
            if (at !== -1) speakers[at] = filled
            awaitingLine = filled
          }
        }
        lastWasAction = false
        break
      }
      case 'paren':
      case 'transition':
        lastWasAction = false
        break
    }
  }

  const shots: ShotSpec[] = []

  // 1. Establishing wide.
  const place: InlineRun[] =
    input.locationId !== null
      ? [mention({ entity: 'location', id: input.locationId })]
      : input.reading !== null && input.reading.set !== ''
        ? [text(input.reading.set)]
        : []
  const time = input.reading?.timeOfDay ?? null
  const opening = actions[0]
  shots.push({
    size: 'ws',
    movement: 'static',
    angle: 'eye_level',
    lensMm: 24,
    durationSeconds: null,
    description: join(
      text('Establishing wide'),
      place.length === 0 ? [] : [text(' of '), ...place],
      time === null ? [] : [text(` · ${time}`)],
      text('.'),
      opening === undefined ? [] : [text(` ${excerpt(opening)}`)],
    ),
  })

  // 2. Two-shot.
  const [first, second] = speakers
  if (first !== undefined && second !== undefined) {
    const rest = speakers.length - 2
    shots.push({
      size: 'ms',
      movement: 'static',
      angle: 'eye_level',
      lensMm: 35,
      durationSeconds: null,
      description: join(
        text('Two-shot: '),
        speakerRun(first),
        text(' and '),
        speakerRun(second),
        rest > 0 ? [text(`, ${String(rest)} more in the scene`)] : [],
        text('.'),
      ),
    })
  }

  // 3. One medium close-up per speaker.
  for (const speaker of speakers.slice(0, MAX_SPEAKER_SHOTS)) {
    shots.push({
      size: 'mcu',
      movement: 'static',
      angle: 'eye_level',
      lensMm: 50,
      durationSeconds: null,
      description: join(
        text('Medium close-up on '),
        speakerRun(speaker),
        speaker.firstLine === null ? [text('.')] : [text(` — “${excerpt(speaker.firstLine, 100)}”`)],
      ),
    })
  }

  // 4. Closing wide.
  const closing = actions[actions.length - 1]
  if (speakers.length > 0 && lastWasAction && closing !== undefined && actions.length > 1) {
    shots.push({
      size: 'ws',
      movement: 'static',
      angle: 'eye_level',
      lensMm: 24,
      durationSeconds: null,
      description: join(text('Closing wide. '), text(excerpt(closing))),
    })
  }

  return shots
}

/** The cue keys `proposeShots` resolves through, built from the alias table's bound cues. */
export const boundCueMap = (
  bound: readonly { readonly cue: string; readonly characterId: CharacterId }[],
): ReadonlyMap<string, CharacterId> => {
  const map = new Map<string, CharacterId>()
  for (const entry of bound) {
    const key = canonicalKey(entry.cue)
    if (key !== '' && !map.has(key)) map.set(key, entry.characterId)
  }
  return map
}
