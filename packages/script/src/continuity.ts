import type { Light } from './entities'
import type { NodeId } from './ids'
import type { StoryTime, TimelineScene } from './timeline'
import { compareStoryTime, precedesStoryTime } from './timeline'

/**
 * The continuity check: where the story time the writer typed disagrees
 * with the page, with itself, or with what the script says - eight rules,
 * pure over data the Timeline route already holds, run on every read and
 * stored nowhere (the rebuild, phase 3). "A finding is a flag, not an
 * error": every rule here names a fact the writer can act on, and none of
 * them is a verdict. The verdict is the writer's - `It's deliberate`, a row
 * in `timeline_findings` keyed on `key` - and the route folds the two
 * together.
 *
 * ## The rules, and the false positives each refuses
 *
 *   `order`               a frame-story scene earlier in story time than a
 *                         scene before it on the page. Against the *latest*
 *                         scene before it, not the adjacent one - `Day 5,
 *                         Day 3, Day 4` is one step back, and the first
 *                         pass flagged the 3 and missed the 4. A run of
 *                         scenes that continue backwards in order is one
 *                         finding, on the run's first scene.
 *   `flashback`           the same fact on a scene the writer flagged - the
 *                         flag is the answer, so the route does not list it.
 *   `flashforward`        a flagged scene that lands *after* the frame - the
 *                         flag's other meaning, invisible before.
 *   `same-day-unclocked`  two consecutive frame scenes on one day, at least
 *                         one without a clock: their order is unknowable.
 *                         Informational - the fix is a clock, not a retime.
 *   `two-places`          a character in two scenes at the same day and
 *                         clock in two different sets.
 *   `before-introduction` a character in a scene earlier in story time than
 *                         the scene that introduces them on the page.
 *                         Skipped on a flashback, where that is the point.
 *   `light-vs-clock`      a `DAY` heading clocked in the night, or a `NIGHT`
 *                         heading clocked in the day, by the margins below.
 *   `thread-silent`       a thread with no scene for `THREAD_SILENT_EPISODES`
 *                         whole episodes or `THREAD_SILENT_PAGES` pages
 *                         between two of its scenes.
 *   `day-gap`             more than `DAY_GAP_DAYS` days between consecutive
 *                         frame scenes - a jump the writer may not have
 *                         meant to be that long.
 *
 * ## Unknown never precedes
 *
 * `precedesStoryTime` is strict: a scene with no clock is never earlier
 * than one on the same day with one. The rules inherit that, so a day with
 * no clocks can produce no `order` finding - which is what
 * `same-day-unclocked` is for.
 *
 * ## Thresholds are constants, not rulings
 *
 * Named here so a test can read them and a later pass can move them; none
 * of them is a client decision.
 */

export type ContinuityKind =
  | 'order'
  | 'flashback'
  | 'flashforward'
  | 'same-day-unclocked'
  | 'two-places'
  | 'before-introduction'
  | 'light-vs-clock'
  | 'thread-silent'
  | 'day-gap'

/** More than this many days between two consecutive frame scenes is a `day-gap`. */
export const DAY_GAP_DAYS = 7
/** This many whole episodes with no scene of a thread is a `thread-silent`. */
export const THREAD_SILENT_EPISODES = 1
/** This many pages between two consecutive scenes of a thread is a `thread-silent`. */
export const THREAD_SILENT_PAGES = 30
/** A `DAY` heading clocked before dawn or after dusk is a `light-vs-clock`. Wide, so a late summer evening is not one. */
export const DAYLIGHT = { from: '05:00', until: '21:00' } as const
/** A `NIGHT` heading clocked inside these hours is a `light-vs-clock`. */
export const NIGHT_HOURS = { from: '07:00', until: '18:00' } as const

/** A scene as the check sees it: the timeline's scene plus what the page says about it. */
export type ContinuityScene = TimelineScene & {
  readonly episodeOrdinal: number
  /** Start page, or null unmeasured. */
  readonly page: number | null
  /** Character ids present (speaking or mentioned). */
  readonly cast: readonly string[]
  /** The set's record id, or null while unresolved. */
  readonly set: string | null
  readonly light: Light
  /** Thread ids, in the writer's order. */
  readonly threads: readonly string[]
}

export type ContinuityFinding = {
  readonly kind: ContinuityKind
  /** Stable across reads: what a verdict is keyed on. */
  readonly key: string
  /** The scene the finding is about. */
  readonly sceneId: NodeId
  /** The scene it is measured against, when there is one. */
  readonly otherId: NodeId | null
  /** A character id or a thread id, for the kinds about one. */
  readonly subject: string | null
  readonly sceneTime: StoryTime | null
  readonly otherTime: StoryTime | null
  /** The size of a gap, for the two gap kinds. */
  readonly gap: { readonly unit: 'days' | 'episodes' | 'pages'; readonly size: number } | null
}

export type ContinuityInput = {
  readonly scenes: readonly ContinuityScene[]
  /** Character id → the heading node that introduces them, from the derivation pass. */
  readonly introductions: ReadonlyMap<string, NodeId>
  /** The thread ids to check for silence - the project's threads. */
  readonly threads: readonly string[]
}

type Placed = ContinuityScene & { readonly storyTime: StoryTime }

const isPlaced = (scene: ContinuityScene): scene is Placed => scene.storyTime !== null

const keyOf = (kind: ContinuityKind, parts: readonly (string | null)[]): string => `${kind}:${parts.map((part) => part ?? '').join(':')}`

const finding = (
  kind: ContinuityKind,
  scene: ContinuityScene,
  other: ContinuityScene | null,
  subject: string | null = null,
  gap: ContinuityFinding['gap'] = null,
): ContinuityFinding => ({
  kind,
  key: keyOf(kind, [scene.id, other?.id ?? null, subject]),
  sceneId: scene.id,
  otherId: other?.id ?? null,
  subject,
  sceneTime: scene.storyTime,
  otherTime: other?.storyTime ?? null,
  gap,
})

/** The latest of two story times by `compareStoryTime`. */
const laterOf = (a: Placed, b: Placed): Placed => (compareStoryTime(b.storyTime, a.storyTime) > 0 ? b : a)

/**
 * `order`, `flashback` and `flashforward`, in one walk of the page.
 *
 * `order` is keyed on the scene alone: which scene it was measured against
 * changes as the writer places more, and a verdict on "this one steps
 * back" should survive that.
 */
const orderFindings = (scenes: readonly ContinuityScene[]): readonly ContinuityFinding[] => {
  const out: ContinuityFinding[] = []
  let latest: Placed | null = null
  let run: Placed | null = null
  for (const scene of scenes) {
    if (!isPlaced(scene)) continue
    if (scene.flashback) {
      if (latest !== null && precedesStoryTime(scene.storyTime, latest.storyTime)) {
        out.push({ ...finding('flashback', scene, latest), key: keyOf('flashback', [scene.id]) })
      } else if (latest !== null && precedesStoryTime(latest.storyTime, scene.storyTime)) {
        out.push({ ...finding('flashforward', scene, latest), key: keyOf('flashforward', [scene.id]) })
      }
      continue
    }
    if (latest !== null && precedesStoryTime(scene.storyTime, latest.storyTime)) {
      // A run continues while each scene is not earlier than the last flagged one.
      if (run === null || precedesStoryTime(scene.storyTime, run.storyTime)) {
        out.push({ ...finding('order', scene, latest), key: keyOf('order', [scene.id]) })
      }
      run = scene
    } else {
      run = null
      latest = latest === null ? scene : laterOf(latest, scene)
    }
  }
  return out
}

/** `same-day-unclocked` and `day-gap`: the pairs of consecutive frame scenes on the page. */
const pairFindings = (scenes: readonly ContinuityScene[]): readonly ContinuityFinding[] => {
  const out: ContinuityFinding[] = []
  let previous: Placed | null = null
  for (const scene of scenes) {
    if (!isPlaced(scene) || scene.flashback) continue
    if (previous !== null) {
      const a = previous.storyTime
      const b = scene.storyTime
      if (a.day === b.day && (a.clock === null || b.clock === null)) {
        out.push(finding('same-day-unclocked', scene, previous))
      } else if (b.day - a.day > DAY_GAP_DAYS) {
        out.push(finding('day-gap', scene, previous, null, { unit: 'days', size: b.day - a.day }))
      }
    }
    previous = scene
  }
  return out
}

/** `two-places`: one finding per pair of scenes and shared character, at one clocked moment in two sets. */
const twoPlacesFindings = (scenes: readonly ContinuityScene[]): readonly ContinuityFinding[] => {
  const out: ContinuityFinding[] = []
  const clocked = scenes.filter((scene): scene is Placed => isPlaced(scene) && scene.storyTime.clock !== null && scene.set !== null)
  for (let i = 0; i < clocked.length; i += 1) {
    const a = clocked[i]
    if (a === undefined) continue
    for (let j = i + 1; j < clocked.length; j += 1) {
      const b = clocked[j]
      if (b === undefined || a.set === b.set) continue
      if (a.storyTime.day !== b.storyTime.day || a.storyTime.clock !== b.storyTime.clock) continue
      for (const person of a.cast) {
        if (b.cast.includes(person)) out.push(finding('two-places', b, a, person))
      }
    }
  }
  return out
}

/** `before-introduction`: a character present earlier in story time than the scene that introduces them. */
const introductionFindings = (scenes: readonly ContinuityScene[], introductions: ReadonlyMap<string, NodeId>): readonly ContinuityFinding[] => {
  const out: ContinuityFinding[] = []
  const byId = new Map<NodeId, ContinuityScene>(scenes.map((scene) => [scene.id, scene]))
  for (const scene of scenes) {
    if (!isPlaced(scene) || scene.flashback) continue
    for (const person of scene.cast) {
      const introId = introductions.get(person)
      if (introId === undefined || introId === scene.id) continue
      const intro = byId.get(introId)
      if (intro === undefined || !isPlaced(intro)) continue
      if (precedesStoryTime(scene.storyTime, intro.storyTime)) out.push(finding('before-introduction', scene, intro, person))
    }
  }
  return out
}

/** `light-vs-clock`: the heading's light against the clock, by the named margins. */
const lightFindings = (scenes: readonly ContinuityScene[]): readonly ContinuityFinding[] =>
  scenes.flatMap((scene) => {
    if (!isPlaced(scene) || scene.storyTime.clock === null) return []
    const clock = scene.storyTime.clock
    const dark = clock < DAYLIGHT.from || clock >= DAYLIGHT.until
    const bright = clock >= NIGHT_HOURS.from && clock < NIGHT_HOURS.until
    if ((scene.light === 'day' && dark) || (scene.light === 'night' && bright)) return [finding('light-vs-clock', scene, null)]
    return []
  })

/** `thread-silent`: the gaps between consecutive scenes of each thread, in page order. */
const silenceFindings = (scenes: readonly ContinuityScene[], threads: readonly string[]): readonly ContinuityFinding[] => {
  const out: ContinuityFinding[] = []
  for (const thread of threads) {
    let previous: ContinuityScene | null = null
    for (const scene of scenes) {
      if (!scene.threads.includes(thread)) continue
      if (previous !== null) {
        const episodes = scene.episodeOrdinal - previous.episodeOrdinal - 1
        if (episodes >= THREAD_SILENT_EPISODES) {
          out.push(finding('thread-silent', scene, previous, thread, { unit: 'episodes', size: episodes }))
        } else if (previous.page !== null && scene.page !== null && scene.page - previous.page >= THREAD_SILENT_PAGES) {
          out.push(finding('thread-silent', scene, previous, thread, { unit: 'pages', size: scene.page - previous.page }))
        }
      }
      previous = scene
    }
  }
  return out
}

/** Every finding of every kind, in the order the rules run. Page order within a kind. */
export const continuityFindings = ({ scenes, introductions, threads }: ContinuityInput): readonly ContinuityFinding[] => [
  ...orderFindings(scenes),
  ...pairFindings(scenes),
  ...twoPlacesFindings(scenes),
  ...introductionFindings(scenes, introductions),
  ...lightFindings(scenes),
  ...silenceFindings(scenes, threads),
]

/** The kinds the writer flagged themselves: reported, never listed as a card. */
export const FLAGGED_KINDS: ReadonlySet<ContinuityKind> = new Set(['flashback', 'flashforward'])

/** The kinds that are a note rather than a disagreement: listed, not counted. */
export const INFORMATIONAL_KINDS: ReadonlySet<ContinuityKind> = new Set(['same-day-unclocked', 'day-gap'])
