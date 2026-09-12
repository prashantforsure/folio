import type { NodeId } from './ids'

/**
 * The timeline: story time against page order.
 *
 * The Timeline brief: "Story order versus what actually happened, across
 * all episodes. Two authored things power it." This file owns the part
 * that is a function of those two things and the page order - nothing
 * here reads a node, a slugline or a table.
 *
 * ## Story time is authored, not parsed
 *
 * "`DAY` and `NIGHT` in a slugline are time of day, not a date, and no
 * syntax expresses 'day 5'. Guessing would fill the continuity report with
 * false positives." So a `StoryTime` is only ever what the writer typed: a
 * day, and optionally a clock. A scene with no story time is **unplaced**,
 * and unplaced is a state every function below handles - it is not a
 * default of Day 1.
 *
 * `day` is any integer. Day 1 is the story's first day by convention and
 * nothing here enforces it; a flashback to before the story opens is a
 * smaller day, a flash-forward a larger one. `clock` is `HH:MM` on the
 * 24-hour clock, compared as text, which orders correctly for that shape
 * and is why the shape is fixed.
 *
 * ## The flashback flag is the writer's answer, not a finding's
 *
 * "A finding is a flag, not an error. Flashbacks are legitimate." The
 * flag on a scene says its jump backwards is meant. `continuityFindings`
 * still reports it - the finding is the fact that page order and story
 * time disagree here - but as `kind: 'flashback'`, and a flashback is
 * skipped when looking for "the scene before it on the page": the scene
 * after a flashback is compared with the last scene of the frame story,
 * not with the flashback, so a return to the present is not a jump and a
 * real step backwards hidden behind a flashback is still found.
 *
 * ## Unknown never precedes
 *
 * Two scenes on the same day, one with a clock and one without, are not in
 * either order. `precedesStoryTime` is strict and returns `false` for
 * them: a finding the writer cannot act on is a false positive, and false
 * positives are what the brief says to avoid.
 */

/** `HH:MM`, 24-hour, zero-padded. Text order is clock order for this shape. */
export const STORY_CLOCK_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

export const isStoryClock = (value: string): boolean => STORY_CLOCK_PATTERN.test(value)

export type StoryTime = {
  /** The story day. Any integer; Day 1 is the first by convention. */
  readonly day: number
  /** `HH:MM`, or null when the writer set only the day. */
  readonly clock: string | null
}

/** A scene as the timeline sees it. The list is in page order across episodes. */
export type TimelineScene = {
  readonly id: NodeId
  readonly storyTime: StoryTime | null
  readonly flashback: boolean
}

export const formatStoryDay = (day: number): string => `Day ${String(day)}`

/** `Day 2 · 06:40`, or `Day 2` with no clock. */
export const formatStoryTime = (time: StoryTime): string =>
  time.clock === null ? formatStoryDay(time.day) : `${formatStoryDay(time.day)} · ${time.clock}`

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/**
 * Sort order: by day, then by clock, a scene with no clock after every
 * clocked scene on that day. Total, so a list can be sorted by it; ties
 * are left to the caller's stable sort, which keeps page order.
 */
export const compareStoryTime = (a: StoryTime, b: StoryTime): number => {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if (a.clock === b.clock) return 0
  if (a.clock === null) return 1
  if (b.clock === null) return -1
  return a.clock < b.clock ? -1 : 1
}

/**
 * Strictly earlier. An earlier day is earlier; the same day is earlier
 * only when both clocks are set and `a`'s is smaller. A missing clock on
 * either side is unknown, and unknown never precedes.
 */
export const precedesStoryTime = (a: StoryTime, b: StoryTime): boolean => {
  if (a.day !== b.day) return a.day < b.day
  if (a.clock === null || b.clock === null) return false
  return a.clock < b.clock
}

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

export type ContinuityFindingKind = 'order' | 'flashback'

/**
 * A scene whose story time precedes the scene before it on the page.
 *
 * `previousId` is the scene it was compared with: the nearest earlier scene
 * on the page that has a story time and is not a flashback. `kind` is
 * `flashback` when the scene itself carries the flag - reported, and
 * legitimate.
 */
export type ContinuityFinding = {
  readonly sceneId: NodeId
  readonly previousId: NodeId
  readonly kind: ContinuityFindingKind
  readonly sceneTime: StoryTime
  readonly previousTime: StoryTime
}

type Placed = { readonly id: NodeId; readonly time: StoryTime; readonly flashback: boolean }

const placedOf = (scenes: readonly TimelineScene[]): readonly Placed[] =>
  scenes.flatMap((scene) =>
    scene.storyTime === null ? [] : [{ id: scene.id, time: scene.storyTime, flashback: scene.flashback }],
  )

/**
 * Every finding, in page order. See the header for what "the scene before
 * it" means when flashbacks are involved.
 */
export const continuityFindings = (scenes: readonly TimelineScene[]): readonly ContinuityFinding[] => {
  const findings: ContinuityFinding[] = []
  let previous: Placed | null = null
  for (const scene of placedOf(scenes)) {
    if (previous !== null && precedesStoryTime(scene.time, previous.time)) {
      findings.push({
        sceneId: scene.id,
        previousId: previous.id,
        kind: scene.flashback ? 'flashback' : 'order',
        sceneTime: scene.time,
        previousTime: previous.time,
      })
    }
    if (!scene.flashback) previous = scene
  }
  return findings
}

export type StoryJump = 'back' | 'ahead'

/**
 * The story-order chip's arrow: `back` is an `order` finding, `ahead` is a
 * scene that skips at least one whole day past the frame-story scene
 * before it. Flashbacks carry neither - the flag says what they are.
 */
export const storyJumps = (scenes: readonly TimelineScene[]): ReadonlyMap<NodeId, StoryJump> => {
  const jumps = new Map<NodeId, StoryJump>()
  let previous: Placed | null = null
  for (const scene of placedOf(scenes)) {
    if (scene.flashback) continue
    if (previous !== null) {
      if (precedesStoryTime(scene.time, previous.time)) jumps.set(scene.id, 'back')
      else if (scene.time.day > previous.time.day + 1) jumps.set(scene.id, 'ahead')
    }
    previous = scene
  }
  return jumps
}

// ---------------------------------------------------------------------------
// Chronology
// ---------------------------------------------------------------------------

export type StoryDayColumn = {
  readonly day: number
  /** In story-time order: by clock, unclocked last, page order between equals. */
  readonly sceneIds: readonly NodeId[]
  /** Every scene on this day is a flashback - the chronology draws it as one. */
  readonly flashbacksOnly: boolean
}

export type Chronology = {
  /** One column per distinct day, ascending. */
  readonly days: readonly StoryDayColumn[]
  /** Scenes with no story time, in page order. Not in any column. */
  readonly unplaced: readonly NodeId[]
}

export const chronology = (scenes: readonly TimelineScene[]): Chronology => {
  const byDay = new Map<number, Placed[]>()
  const unplaced: NodeId[] = []
  for (const scene of scenes) {
    if (scene.storyTime === null) {
      unplaced.push(scene.id)
      continue
    }
    const list = byDay.get(scene.storyTime.day) ?? []
    list.push({ id: scene.id, time: scene.storyTime, flashback: scene.flashback })
    byDay.set(scene.storyTime.day, list)
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, list]) => {
      const ordered = [...list].sort((a, b) => compareStoryTime(a.time, b.time))
      return {
        day,
        sceneIds: ordered.map((scene) => scene.id),
        flashbacksOnly: ordered.every((scene) => scene.flashback),
      }
    })
  return { days, unplaced }
}

// ---------------------------------------------------------------------------
// Span
// ---------------------------------------------------------------------------

export type StorySpan = {
  readonly from: number
  readonly to: number
  /** Calendar days from the first to the last, inclusive. */
  readonly days: number
}

/**
 * How long the frame story runs: first to last day over the placed,
 * non-flashback scenes. Null when nothing is placed. Flashbacks sit
 * outside the count, which is what the flag means.
 */
export const storySpan = (scenes: readonly TimelineScene[]): StorySpan | null => {
  let from: number | null = null
  let to: number | null = null
  for (const scene of scenes) {
    if (scene.storyTime === null || scene.flashback) continue
    const { day } = scene.storyTime
    from = from === null || day < from ? day : from
    to = to === null || day > to ? day : to
  }
  if (from === null || to === null) return null
  return { from, to, days: to - from + 1 }
}
