import { canonicalKey, confidenceRank, scoreMatch } from './alias'
import type { Confidence, InteriorExterior, Light, MatchReason } from './entities'
import type { LocationId, NodeId } from './ids'
import type { InlineContent, MentionTarget } from './inline'
import type { ScreenplayNode } from './node'

/**
 * What the Locations route reads off the script beyond what a derivation
 * pass stores: which record a set text resembles and why, which two
 * records read as one place, the first line of action the page writes
 * about a set, and the interior / exterior against day / night split a
 * schedule is built around.
 *
 * ## Read at request time, not stored
 *
 * AGENTS.md, "Nothing is stored that can be computed - except": a derived
 * entity row is stored for cross-episode queryability, and these are not
 * rows - they are readings over rows the route already has in hand (the
 * scene index, the node list) for the one request that draws them. So
 * nothing here writes, nothing here is a column, and `derive.ts` is
 * untouched. A pass that later wants to cache one of them can store what
 * these return; the reading would not change.
 *
 * ## Evidence, never a binding
 *
 * `matchSetNames` and `similarSets` are the queue's own scoring
 * (`scoreMatch`) over a lighter pool, so the route's `Somewhere else…`
 * menu and its `Same place?` finding say exactly what later passes would
 * propose. `establishingLines` quotes a node; it binds nothing and feeds
 * no queue. Deterministic and pure, like every reader in this package.
 */

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** A record as matching sees it: its id, name and bound set texts - the alias table's three columns. */
export type SetPool = {
  readonly id: LocationId
  readonly name: string
  readonly boundSluglines: readonly string[]
}

/** One existing record a set text resembles, how closely, and by which rule. */
export type SetMatch = {
  readonly id: LocationId
  readonly confidence: Confidence
  readonly reason: MatchReason
}

const keysOf = (record: SetPool): readonly string[] =>
  [...new Set([canonicalKey(record.name), ...record.boundSluglines.map(canonicalKey)])].filter((key) => key !== '')

/**
 * Every record a set text resembles, best first; ties in pool order, so the
 * answer does not depend on how the list was assembled. `set` is the set
 * text (`KAMATHI CHAWL - CORRIDOR`), not a whole heading - the caller reads
 * a heading down to its set first (`readSlugline`).
 */
export const matchSetNames = (set: string, pool: readonly SetPool[]): readonly SetMatch[] => {
  const key = canonicalKey(set)
  if (key === '') return []
  const scored: { readonly match: SetMatch; readonly order: number }[] = []
  pool.forEach((record, order) => {
    let best: { readonly confidence: Confidence; readonly reason: MatchReason } | null = null
    for (const candidate of keysOf(record)) {
      const score = scoreMatch(key, candidate)
      if (score === null) continue
      if (best === null || confidenceRank(score.confidence) < confidenceRank(best.confidence)) best = score
    }
    if (best !== null) scored.push({ match: { id: record.id, confidence: best.confidence, reason: best.reason }, order })
  })
  scored.sort((a, b) => confidenceRank(a.match.confidence) - confidenceRank(b.match.confidence) || a.order - b.order)
  return scored.map((entry) => entry.match)
}

/** Two records that read as one place - `THE CHAWL` beside `KAMATHI CHAWL` - by the queue's own scoring. */
export type SimilarSets = {
  readonly a: LocationId
  readonly b: LocationId
  readonly confidence: Confidence
  readonly reason: MatchReason
}

/**
 * Every pair of records whose names or bound set texts resemble each other
 * at `certain` or `likely` - a `possible` is too weak to put in front of a
 * writer as "same place?". A record under another in the tree is never
 * paired with its parent: `KAMATHI CHAWL - CORRIDOR` contains `KAMATHI
 * CHAWL` by design, and the tree already says so.
 */
export const similarSets = (
  pool: readonly (SetPool & { readonly parentId: LocationId | null })[],
): readonly SimilarSets[] => {
  const keys = pool.map(keysOf)
  const pairs: SimilarSets[] = []
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i]
      const b = pool[j]
      if (a === undefined || b === undefined) continue
      if (a.parentId === b.id || b.parentId === a.id) continue
      let best: { readonly confidence: Confidence; readonly reason: MatchReason } | null = null
      for (const x of keys[i] ?? []) {
        for (const y of keys[j] ?? []) {
          const score = scoreMatch(x, y)
          if (score === null || score.confidence === 'possible') continue
          if (best === null || confidenceRank(score.confidence) < confidenceRank(best.confidence)) best = score
        }
      }
      if (best !== null) pairs.push({ a: a.id, b: b.id, confidence: best.confidence, reason: best.reason })
    }
  }
  return pairs
}

// ---------------------------------------------------------------------------
// The establishing line
// ---------------------------------------------------------------------------

/** The first action the page writes under a heading at this set: the closest thing a script has to a description of a place. */
export type EstablishingLine = {
  readonly nodeId: NodeId
  /** The heading it sits under. */
  readonly sceneNodeId: NodeId
  readonly text: string
}

/** How a mention renders in the quoted line: the record's name, or nothing when the label book has none. */
export type MentionLabelFor = (target: MentionTarget) => string | undefined

const plainText = (content: InlineContent, labelFor: MentionLabelFor): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : (labelFor(run.target) ?? '')))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()

/**
 * For every record, the first non-empty action node under any of its
 * headings, in document order - "the first thing the page says about the
 * place". `locationOf` is the scene index's resolution of a heading node
 * to a record (a heading in the queue resolves to nothing and its action
 * lines credit nobody). A record with no action under any heading has no
 * entry. Action only: a cue or a line of dialogue under the heading is not
 * about the place.
 */
export const establishingLines = (
  nodes: readonly ScreenplayNode[],
  locationOf: (sceneNodeId: NodeId) => LocationId | null,
  labelFor: MentionLabelFor,
): ReadonlyMap<LocationId, EstablishingLine> => {
  const out = new Map<LocationId, EstablishingLine>()
  let current: { readonly location: LocationId; readonly sceneNodeId: NodeId } | null = null
  for (const node of nodes) {
    if (node.type === 'scene') {
      const location = locationOf(node.id)
      current = location === null ? null : { location, sceneNodeId: node.id }
      continue
    }
    if (current === null || node.type !== 'action' || out.has(current.location)) continue
    const text = plainText(node.content, labelFor)
    if (text === '') continue
    out.set(current.location, { nodeId: node.id, sceneNodeId: current.sceneNodeId, text })
  }
  return out
}

// ---------------------------------------------------------------------------
// The quadrant
// ---------------------------------------------------------------------------

/**
 * The breakdown's four boxes plus the one a heading with no time of day
 * falls in. `INT` is interior; `EXT`, `INT/EXT` and `EST` are exterior -
 * an I/E scene and an establishing shot both need the outside, which is
 * what a schedule is asking.
 */
export type Quadrant = {
  readonly intDay: number
  readonly intNight: number
  readonly extDay: number
  readonly extNight: number
  /** Headings that say neither `DAY` nor `NIGHT`. */
  readonly unlit: number
}

export const NO_QUADRANT: Quadrant = { intDay: 0, intNight: 0, extDay: 0, extNight: 0, unlit: 0 }

export const quadrantOf = (readings: readonly { readonly ie: InteriorExterior; readonly light: Light }[]): Quadrant => {
  let intDay = 0
  let intNight = 0
  let extDay = 0
  let extNight = 0
  let unlit = 0
  for (const reading of readings) {
    if (reading.light === 'unspecified') {
      unlit += 1
      continue
    }
    const interior = reading.ie === 'INT'
    if (reading.light === 'day') {
      if (interior) intDay += 1
      else extDay += 1
    } else if (interior) intNight += 1
    else extNight += 1
  }
  return { intDay, intNight, extDay, extNight, unlit }
}

export const addQuadrants = (a: Quadrant, b: Quadrant): Quadrant => ({
  intDay: a.intDay + b.intDay,
  intNight: a.intNight + b.intNight,
  extDay: a.extDay + b.extDay,
  extNight: a.extNight + b.extNight,
  unlit: a.unlit + b.unlit,
})
