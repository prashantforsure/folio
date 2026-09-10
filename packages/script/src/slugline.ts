import type { InteriorExterior, Light, SluglineReading } from './entities'
import type { RejectedHeadingReason } from './fountain-syntax'
import { classifyHeading, headingParts } from './fountain-syntax'
import type { Result } from './result'
import { err, ok } from './result'

/**
 * Reading a scene heading.
 *
 * AGENTS.md, Derivation: "A malformed heading does not silently become a scene.
 * `INTERCUT - PHONE CALL` is not an interior scene at location `ERCUT`."
 *
 * **That decision is not re-made here.** `classifyHeading` in
 * `fountain-syntax.ts` already owns it - the word boundary after the prefix is
 * the whole rule, and it is tested there - so this module asks it and reports
 * whatever it says. Two implementations of "is this a heading" is precisely the
 * failure AGENTS.md describes, "some other surface quietly becoming
 * authoritative", and it would show up as a scene that exists in the Scenes
 * route and not in the script, or the reverse.
 *
 * The reason it has to be asked at all is that a *node* can be a Scene node
 * without its text being a heading: FDX import maps `Type="Scene Heading"`
 * faithfully, so a Final Draft file that declares `INTERCUT - PHONE CALL` a
 * heading produces a Scene node (reported, never silent). Derivation then
 * declines to build a scene record from it, and reports that too.
 *
 * ## What this module does decide
 *
 * Splitting the set text from the time of day, and the day/night reduction. Both
 * are vocabulary judgements, both are wrong sometimes, and both are visible in
 * the product rather than load-bearing for identity:
 *
 *   - The time of day is only taken off when the last segment is a **known**
 *     one. An unknown trailing segment stays part of the set, because the
 *     alternative - assuming the last segment is always a time - turns
 *     `INT. THE MILL - OFFICE` into the set `THE MILL` at time `OFFICE`, and
 *     that is the `ERCUT` mistake with different words.
 *   - `DUSK` and `SUNSET` are counted as night, `DAWN` as day. This is a
 *     scheduling convention and productions differ; the value is on the reading
 *     rather than baked into a count, so a later ruling can change it in one
 *     place. Flagged in the report as an assumption.
 *   - `CONTINUOUS`, `LATER` and `SAME` are times of day that say nothing about
 *     light, which is `unspecified` - not a failure, and not a default to `day`.
 */

/** ` - `, an en or em dash with spaces, or a double hyphen. All seen in real sluglines. */
const SEGMENT_SEPARATOR = /\s+[-–—]{1,2}\s+|\s*--\s*/u

const DAY_TIMES: readonly string[] = [
  'DAY',
  'MORNING',
  'EARLY MORNING',
  'LATE MORNING',
  'MIDDAY',
  'NOON',
  'AFTERNOON',
  'LATE AFTERNOON',
  'DAWN',
  'SUNRISE',
  'DAYBREAK',
]

const NIGHT_TIMES: readonly string[] = [
  'NIGHT',
  'LATE NIGHT',
  'EVENING',
  'DUSK',
  'SUNSET',
  'TWILIGHT',
  'NIGHTFALL',
  'MIDNIGHT',
  'MOONLIGHT',
]

/** Times that are legitimate and say nothing about light. */
const UNSPECIFIED_TIMES: readonly string[] = [
  'CONTINUOUS',
  'LATER',
  'MOMENTS LATER',
  'SAME',
  'SAME TIME',
  'SECONDS LATER',
  'MAGIC HOUR',
]

const TIME_LIGHT: ReadonlyMap<string, Light> = new Map([
  ...DAY_TIMES.map((time): readonly [string, Light] => [time, 'day']),
  ...NIGHT_TIMES.map((time): readonly [string, Light] => [time, 'night']),
  ...UNSPECIFIED_TIMES.map((time): readonly [string, Light] => [time, 'unspecified']),
])

/**
 * `INT.`, `INT`, `I/E.`, `INT./EXT` all reduce to four values.
 *
 * Dots and spaces removed, `I/E` folded onto `INT/EXT`, because the set is what
 * the breakdown counts by and `INT.` versus `INT` is not a distinction anybody
 * means.
 */
const readInteriorExterior = (prefix: string): InteriorExterior => {
  const bare = prefix.replace(/[.\s]/gu, '').toUpperCase()
  if (bare === 'IE' || bare === 'I/E' || bare === 'INT/EXT' || bare === 'EXT/INT') return 'INT/EXT'
  if (bare === 'EST') return 'EST'
  if (bare === 'EXT') return 'EXT'
  return 'INT'
}

export type SluglineRejection =
  /** The Scene node's text is not heading-shaped at all. */
  | { readonly kind: 'not-a-heading'; readonly heading: string }
  /** `classifyHeading` rejected it, and this is its reason, unchanged. */
  | { readonly kind: 'rejected'; readonly heading: string; readonly reason: RejectedHeadingReason }

/**
 * A heading, or the reason it is not one.
 *
 * Nothing throws: AGENTS.md, Conventions > Errors - "a malformed heading is
 * *data*, not an exception, and it must be representable in the return type."
 */
export const readSlugline = (heading: string): Result<SluglineReading, SluglineRejection> => {
  const trimmed = heading.trim()
  const verdict = classifyHeading(trimmed)
  if (verdict.kind === 'none') return err({ kind: 'not-a-heading', heading: trimmed })
  if (verdict.kind === 'rejected') {
    return err({ kind: 'rejected', heading: trimmed, reason: verdict.reason })
  }

  const parts = headingParts(trimmed)
  if (parts === null) return err({ kind: 'not-a-heading', heading: trimmed })

  const segments = parts.set
    .split(SEGMENT_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')

  const last = segments[segments.length - 1]
  const light = last === undefined ? undefined : TIME_LIGHT.get(last.toUpperCase())
  // A heading that is *only* a time of day keeps it as the set. `INT. NIGHT` is
  // a set called NIGHT, badly named, not a scene with no location at all.
  const takeTime = light !== undefined && segments.length > 1
  const setSegments = takeTime ? segments.slice(0, -1) : segments

  return ok({
    ie: readInteriorExterior(parts.prefix),
    set: setSegments.join(' - '),
    segments: setSegments,
    timeOfDay: takeTime && last !== undefined ? last : null,
    light: takeTime && light !== undefined ? light : 'unspecified',
  })
}
