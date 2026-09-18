import type { Light } from './entities'
import type { NodeId } from './ids'
import type { InlineContent, MentionTarget } from './inline'
import type { ScreenplayNode } from './node'
import { readSlugline } from './slugline'
import type { StoryTime, TimelineScene } from './timeline'

/**
 * What the page itself says about when a scene happens, and the placements
 * that follow from it - the Timeline's proposal queue (the rebuild, phase 2).
 *
 * ## Read at request time, never stored, never written on its own
 *
 * The 2026-09-12 brief was right that "`DAY` and `NIGHT` in a slugline are
 * time of day, not a date, and no syntax expresses 'day 5'", and nothing
 * here writes a story day. What a heading *does* say is how the scene binds
 * to the one before it - `CONTINUOUS` and `SAME TIME` are the same moment,
 * `LATER` the same day - and what an action line sometimes says is a count:
 * "the next morning", "three days later", "that night". `timeCuesOf` reads
 * those, quoting the node they come from, and `proposePlacements` turns them
 * into a day per unplaced scene *as a proposal*, with the reason beside it.
 * Accepting one is the writer typing that day; skipping it writes nothing.
 * That is the difference from the first pass's `Assume continuous`, which
 * wrote Day 1 to everything as if the writer had.
 *
 * ## Exact counts only
 *
 * "Two weeks later" is fourteen days; "a month later" is not a number of
 * days and "1997" is not a day at all. Those are still cues - the drawer
 * quotes them so the writer decides with the page in view - but their
 * `offsetDays` is null and the proposal for that scene is a carry, marked
 * as one. A guess dressed as a count is the false positive the brief warns
 * against.
 *
 * Deterministic and pure, like every reader in this package.
 */

/** How a heading's time of day binds a scene to the one before it on the page. */
export type HeadingBind = 'continuous' | 'later' | null

export type ActionCue = {
  readonly nodeId: NodeId
  /** The words matched, as the page has them. */
  readonly quote: string
  /** Whole days after the scene before it: 0 is the same day, negative is earlier. Null when the cue names a moment nothing here can count. */
  readonly offsetDays: number | null
}

export type SceneTimeCues = {
  readonly sceneNodeId: NodeId
  /** The heading's time of day as written (`DAY`, `CONTINUOUS`), or null. */
  readonly timeOfDay: string | null
  readonly light: Light
  readonly bind: HeadingBind
  /** The first action line under the heading that names a time, if one does. */
  readonly action: ActionCue | null
}

/** How many action lines under a heading are read for a cue. A time named deeper into a scene is usually a cut within it. */
export const CUE_ACTION_LINES = 2

const CONTINUOUS_TIMES: ReadonlySet<string> = new Set(['CONTINUOUS', 'SAME', 'SAME TIME'])
const LATER_TIMES: ReadonlySet<string> = new Set(['LATER', 'MOMENTS LATER', 'SECONDS LATER'])

const bindOf = (timeOfDay: string | null): HeadingBind => {
  if (timeOfDay === null) return null
  const upper = timeOfDay.toUpperCase()
  if (CONTINUOUS_TIMES.has(upper)) return 'continuous'
  if (LATER_TIMES.has(upper)) return 'later'
  return null
}

const SMALL_NUMBERS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const countOf = (word: string): number | null => {
  const lower = word.toLowerCase()
  if (/^\d+$/u.test(lower)) return Number(lower)
  return SMALL_NUMBERS[lower] ?? null
}

/** Days per unit where the count is exact; a month or a year is not a count of days. */
const UNIT_DAYS: Readonly<Record<string, number | null>> = {
  day: 1,
  week: 7,
  month: null,
  year: null,
  hour: 0,
  minute: 0,
  moment: 0,
  second: 0,
}

type Rule = {
  readonly pattern: RegExp
  readonly offset: (match: RegExpExecArray) => number | null
}

const RULES: readonly Rule[] = [
  // "the next morning", "the following day", "next night"
  { pattern: /\b(?:the\s+)?(?:next|following)\s+(?:morning|day|afternoon|evening|night)\b/iu, offset: () => 1 },
  // "that night", "the same day", "later that evening"
  { pattern: /\b(?:later\s+)?(?:that|the\s+same)\s+(?:morning|day|afternoon|evening|night)\b/iu, offset: () => 0 },
  // "moments later", "an hour later", "three days later", "two weeks later", "a year later", "several days later"
  {
    pattern: /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|a\s+few|a\s+couple\s+of|some)\s+(moment|second|minute|hour|day|week|month|year)s?\s+(later|on|after|earlier|before|ago)\b/iu,
    offset: (match) => {
      const unit = UNIT_DAYS[(match[2] ?? '').toLowerCase()]
      const count = countOf((match[1] ?? '').replace(/\s+/gu, ' '))
      if (unit === null || unit === undefined || count === null) return null
      const direction = /^(earlier|before|ago)$/iu.test(match[3] ?? '') ? -1 : 1
      return unit * count * direction
    },
  },
  // "moments later" with no count word
  { pattern: /\b(?:moments|seconds|minutes|hours)\s+later\b/iu, offset: () => 0 },
  // "days later", "weeks earlier", "years before" - a unit with no count
  { pattern: /\b(?:days|weeks|months|years)\s+(?:later|earlier|before|ago)\b/iu, offset: () => null },
  // a year on its own: "1997", "Summer, 2004"
  { pattern: /(?<![\d.])(?:1[89]\d\d|20\d\d)(?!\d)/u, offset: () => null },
]

const plainText = (content: InlineContent, labelFor: (target: MentionTarget) => string | undefined): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : (labelFor(run.target) ?? '')))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()

/** The first rule that matches a line, with the words it matched. */
const cueInLine = (text: string): { readonly quote: string; readonly offsetDays: number | null } | null => {
  for (const rule of RULES) {
    const match = rule.pattern.exec(text)
    if (match === null) continue
    return { quote: match[0].replace(/\s+/gu, ' '), offsetDays: rule.offset(match) }
  }
  return null
}

/**
 * The time cues of every accepted scene: the heading's time of day and how
 * it binds, and the first action line among the scene's first
 * `CUE_ACTION_LINES` that names a time. `headings` is the set of heading
 * nodes the derivation pass accepted - a rejected heading ends no scene,
 * so its lines belong to the scene above it. A heading `readSlugline`
 * refuses reads as no time of day.
 */
export const timeCuesOf = (
  nodes: readonly ScreenplayNode[],
  headings: ReadonlySet<NodeId>,
  labelFor: (target: MentionTarget) => string | undefined = () => undefined,
): ReadonlyMap<NodeId, SceneTimeCues> => {
  const out = new Map<NodeId, SceneTimeCues>()
  let current: { cues: SceneTimeCues; actions: number } | null = null
  const flush = (): void => {
    if (current !== null) out.set(current.cues.sceneNodeId, current.cues)
  }
  for (const node of nodes) {
    if (node.type === 'scene' && headings.has(node.id)) {
      flush()
      const reading = readSlugline(plainText(node.content, labelFor))
      const timeOfDay = reading.ok ? reading.value.timeOfDay : null
      current = {
        cues: { sceneNodeId: node.id, timeOfDay, light: reading.ok ? reading.value.light : 'unspecified', bind: bindOf(timeOfDay), action: null },
        actions: 0,
      }
      continue
    }
    if (current === null || node.type !== 'action' || current.cues.action !== null || current.actions >= CUE_ACTION_LINES) continue
    const text = plainText(node.content, labelFor)
    if (text === '') continue
    current.actions += 1
    const cue = cueInLine(text)
    if (cue === null) continue
    current = { ...current, cues: { ...current.cues, action: { nodeId: node.id, quote: cue.quote, offsetDays: cue.offsetDays } } }
  }
  flush()
  return out
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** Why a proposal says the day it says. */
export type PlacementReason = 'continuous' | 'later' | 'cue' | 'carried'

export type PlacementProposal = {
  readonly sceneNodeId: NodeId
  readonly time: StoryTime
  readonly reason: PlacementReason
  /** The words the day was read from - the heading's time or the action cue - or null for a carry. */
  readonly quote: string | null
  /** The node the quote sits in, for a citation; null for a carry or a heading's own time. */
  readonly cueNodeId: NodeId | null
}

/**
 * One proposed story time per unplaced, unflagged scene, in page order,
 * each counted from the last frame-story scene before it - placed by the
 * writer, or proposed just above. `CONTINUOUS` takes that scene's day and
 * clock; `LATER` its day; an exact action cue adds its days; anything else
 * carries the day. The first scene with nothing before it starts on
 * `firstDay`. A flashback-flagged scene is skipped - its place is outside
 * the frame, and only the writer knows where - and never counted from.
 */
export const proposePlacements = (
  scenes: readonly (TimelineScene & { readonly cues: SceneTimeCues | null })[],
  firstDay = 1,
): readonly PlacementProposal[] => {
  const out: PlacementProposal[] = []
  let current: StoryTime | null = null
  for (const scene of scenes) {
    if (scene.flashback) continue
    if (scene.storyTime !== null) {
      current = scene.storyTime
      continue
    }
    const base: StoryTime = current ?? { day: firstDay, clock: null }
    const cues = scene.cues
    let proposal: PlacementProposal
    if (cues?.bind === 'continuous') {
      proposal = { sceneNodeId: scene.id, time: base, reason: 'continuous', quote: cues.timeOfDay, cueNodeId: null }
    } else if (cues?.bind === 'later') {
      proposal = { sceneNodeId: scene.id, time: { day: base.day, clock: null }, reason: 'later', quote: cues.timeOfDay, cueNodeId: null }
    } else if (cues?.action !== null && cues?.action !== undefined && cues.action.offsetDays !== null) {
      proposal = {
        sceneNodeId: scene.id,
        time: { day: base.day + cues.action.offsetDays, clock: null },
        reason: 'cue',
        quote: cues.action.quote,
        cueNodeId: cues.action.nodeId,
      }
    } else {
      proposal = { sceneNodeId: scene.id, time: { day: base.day, clock: null }, reason: 'carried', quote: null, cueNodeId: null }
    }
    out.push(proposal)
    current = proposal.time
  }
  return out
}
