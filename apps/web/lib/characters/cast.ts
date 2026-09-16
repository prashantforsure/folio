import type { CastRow, CharacterMap, CharacterStatus, ResolveItem, SceneRef } from '@folio/contracts'
import type { CharacterId, NodeId } from '@folio/script'

/**
 * The derived fields the v2 Characters route prints, each a pure function
 * over the rows the loader joins - `docs/ui design/Route - Characters
 * v2.dc.html`'s `data()` read for the shape the UI needs, then computed
 * from the real tables rather than authored. Tested in
 * `tests/characters-cast.test.ts`.
 *
 * Nothing here estimates and nothing calls a model. A per-episode count is
 * arithmetic over `character_derivations.scenes` joined to the scene index;
 * a group is a threshold over scene counts; a conflict is an open row in
 * the resolve queue. AGENTS.md, UI fidelity: every number is "computed from
 * the script".
 */

// ---------------------------------------------------------------------------
// Scenes: per episode, first and last
// ---------------------------------------------------------------------------

/** The scene refs a character is in, in script order, from its heading ids. */
export const refsOf = (scenes: readonly NodeId[], refs: ReadonlyMap<NodeId, SceneRef>): readonly SceneRef[] =>
  scenes
    .flatMap((id) => {
      const ref = refs.get(id)
      return ref === undefined ? [] : [ref]
    })
    .sort((a, b) => a.episodeOrdinal - b.episodeOrdinal || a.number - b.number)

/**
 * How many of the character's scenes fall in each episode, in episode
 * order - the README's episode bars. Every episode gets a slot, so an
 * episode the character is absent from is a `0` and draws `--line2`.
 */
export const perEpisode = (
  scenes: readonly NodeId[],
  refs: ReadonlyMap<NodeId, SceneRef>,
  episodeOrdinals: readonly number[],
): readonly number[] => {
  const counts = new Map<number, number>(episodeOrdinals.map((ordinal) => [ordinal, 0]))
  for (const ref of refsOf(scenes, refs)) {
    const seen = counts.get(ref.episodeOrdinal)
    if (seen !== undefined) counts.set(ref.episodeOrdinal, seen + 1)
  }
  return episodeOrdinals.map((ordinal) => counts.get(ordinal) ?? 0)
}

/** `E1 Sc 1 → E3 Sc 30`; null with no scene. */
export const firstLast = (
  scenes: readonly NodeId[],
  refs: ReadonlyMap<NodeId, SceneRef>,
): { readonly first: SceneRef; readonly last: SceneRef } | null => {
  const ordered = refsOf(scenes, refs)
  const first = ordered[0]
  const last = ordered.at(-1)
  return first === undefined || last === undefined ? null : { first, last }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** `79 scenes`, `1 scene`, or the README's line for a claim with no ref. */
export const sceneLabel = (appearances: number): string =>
  appearances === 0 ? 'Not on the page yet' : appearances === 1 ? '1 scene' : `${String(appearances)} scenes`

/**
 * The mockup's `short`: the name a sidebar row and a graph node print. The
 * mockup authors it (`Suresh Kadam` → `Kadam`); with nothing authored, the
 * first word - or the second when the name starts with an article, so
 * `The Driver` reads `Driver` as the mockup has it.
 */
export const shortName = (name: string): string => {
  const words = name.trim().split(/\s+/).filter((word) => word !== '')
  const first = words[0]
  if (first === undefined) return name
  if (/^(the|a|an)$/i.test(first) && words[1] !== undefined) return words[1]
  return first
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = 'warn' | 'ok' | 'accent'

/** README, "Status as a dot plus a pill": amber draft, green defined, accent locked. */
export const statusTone = (status: CharacterStatus): Tone =>
  status === 'draft' ? 'warn' : status === 'defined' ? 'ok' : 'accent'

/** The sidebar widget: `Defined 4 / 6`, and `2 still drafts`. */
export const definedOf = (
  rows: readonly { readonly status: CharacterStatus }[],
): { readonly defined: number; readonly total: number; readonly percent: number; readonly note: string } => {
  const total = rows.length
  const defined = rows.filter((row) => row.status !== 'draft').length
  const drafts = total - defined
  return {
    defined,
    total,
    percent: total === 0 ? 0 : Math.round((defined / total) * 100),
    note: drafts === 0 ? (total === 0 ? 'No characters yet' : 'Nothing still a draft') : `${String(drafts)} still ${drafts === 1 ? 'a draft' : 'drafts'}`,
  }
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * The sidebar's groups. The mockup authors `Principal | Supporting`
 * (`0013` dropped the column of that name); here they are a threshold: a
 * character with at least a fifth of the lead's scenes is a principal, the
 * rest on the page are supporting, and a record with no scene at all - kept
 * by design, AGENTS.md's "0 appearances · record kept" - sits under the
 * README's own line for a claim with no ref. A judgement, flagged in
 * `docs/build-decisions.md`.
 */
export type CastGroup = 'principal' | 'supporting' | 'off-page'

export const CAST_GROUPS: readonly CastGroup[] = ['principal', 'supporting', 'off-page']

export const CAST_GROUP_LABELS: Readonly<Record<CastGroup, string>> = {
  principal: 'Principal',
  supporting: 'Supporting',
  'off-page': 'Not on the page yet',
}

export const PRINCIPAL_SHARE = 0.2

export const groupOf = (appearances: number, lead: number): CastGroup =>
  appearances === 0 ? 'off-page' : appearances >= lead * PRINCIPAL_SHARE ? 'principal' : 'supporting'

/** The lead's scene count: the threshold every group reads against. */
export const leadOf = (rows: readonly { readonly appearances: number }[]): number =>
  rows.reduce((most, row) => Math.max(most, row.appearances), 0)

// ---------------------------------------------------------------------------
// Conflicts: the resolve queue, per record
// ---------------------------------------------------------------------------

/**
 * The one disagreement between a record and the script the model detects:
 * an open cue whose proposal points at a record - `MIRA` reads like
 * `Meera Pawar`. README, "Conflict blocks": the card's border turns
 * `--warn` and an amber block offers to accept the change (bind the
 * spelling) or mark it deliberate (reject that candidate). The script is
 * never edited either way.
 */
export const conflictsOf = (resolve: readonly ResolveItem[]): ReadonlyMap<CharacterId, readonly ResolveItem[]> => {
  const byRecord = new Map<CharacterId, ResolveItem[]>()
  for (const item of resolve) {
    if (item.proposal === null || item.proposal.kind !== 'character') continue
    const list = byRecord.get(item.proposal.id) ?? []
    list.push(item)
    byRecord.set(item.proposal.id, list)
  }
  return byRecord
}

/** `3 names in the script don't match a character` - the banner's line. */
export const unmatchedLabel = (count: number): string =>
  count === 1 ? "1 name in the script doesn't match a character" : `${String(count)} names in the script don't match a character`

// ---------------------------------------------------------------------------
// The relationships graph
// ---------------------------------------------------------------------------

export type GraphPoint = { readonly x: number; readonly y: number }

export type GraphEdge = {
  readonly a: number
  readonly b: number
  readonly shared: number
}

/**
 * Every pair that shares a scene, plus every pair of principals that never
 * does - the mockup's dashed amber edge, `never share a scene`. A zero
 * between two supporting characters is not drawn: with a cast of twenty it
 * would be most of the picture and none of the point.
 */
export const graphEdges = (map: CharacterMap, groups: readonly CastGroup[]): readonly GraphEdge[] => {
  const edges: GraphEdge[] = []
  map.cells.forEach((row, a) => {
    row.forEach((shared, b) => {
      if (b <= a) return
      if (shared > 0 || (groups[a] === 'principal' && groups[b] === 'principal')) edges.push({ a, b, shared })
    })
  })
  return edges.sort((x, y) => y.shared - x.shared)
}

/** The first pair of principals with no scene together, by combined scenes; the finding under the graph. */
export const neverShare = (map: CharacterMap, groups: readonly CastGroup[]): readonly [number, number] | null => {
  let best: readonly [number, number] | null = null
  let weight = -1
  map.cells.forEach((row, a) => {
    row.forEach((shared, b) => {
      if (b <= a || shared > 0) return
      if (groups[a] !== 'principal' || groups[b] !== 'principal') return
      const w = (map.columns[a]?.scenes ?? 0) + (map.columns[b]?.scenes ?? 0)
      if (w > weight) {
        weight = w
        best = [a, b]
      }
    })
  })
  return best
}

/**
 * Where each node sits, as percentages of the ground - the mockup places
 * its six by hand (`x: 38, y: 48`); this is a small deterministic force
 * layout instead. Nodes start on an ellipse in scene order, the lead at
 * the top; every pair repels, every shared scene pulls, a light gravity
 * holds the middle. Fixed steps, no randomness, so the same cast draws the
 * same picture on every visit. No dependency: forty lines for a picture
 * that does not move.
 */
export const graphLayout = (map: CharacterMap): readonly GraphPoint[] => {
  const n = map.columns.length
  if (n === 0) return []
  if (n === 1) return [{ x: 50, y: 50 }]
  const most = map.cells.reduce((top, row, i) => Math.max(top, ...row.filter((_, j) => j !== i)), 1)
  const xs = Array.from({ length: n }, (_, i) => 50 + 34 * Math.cos(-Math.PI / 2 + (i / n) * Math.PI * 2))
  const ys = Array.from({ length: n }, (_, i) => 50 + 30 * Math.sin(-Math.PI / 2 + (i / n) * Math.PI * 2))
  for (let step = 0; step < 240; step += 1) {
    const dx = new Array<number>(n).fill(0)
    const dy = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const ex = (xs[j] ?? 0) - (xs[i] ?? 0)
        const ey = (ys[j] ?? 0) - (ys[i] ?? 0)
        const d = Math.max(4, Math.hypot(ex, ey))
        const ux = ex / d
        const uy = ey / d
        // Repulsion, inverse-square, strong enough to keep pills apart.
        const push = 900 / (d * d)
        // Attraction along a shared-scene edge, toward a 28-unit rest length.
        const shared = map.cells[i]?.[j] ?? 0
        const pull = shared === 0 ? 0 : ((shared / most) * (d - 28)) / 40
        const f = pull - push
        dx[i] = (dx[i] ?? 0) + ux * f
        dy[i] = (dy[i] ?? 0) + uy * f
        dx[j] = (dx[j] ?? 0) - ux * f
        dy[j] = (dy[j] ?? 0) - uy * f
      }
      dx[i] = (dx[i] ?? 0) + (50 - (xs[i] ?? 50)) * 0.01
      dy[i] = (dy[i] ?? 0) + (50 - (ys[i] ?? 50)) * 0.01
    }
    const cool = 1 - step / 240
    for (let i = 0; i < n; i += 1) {
      xs[i] = (xs[i] ?? 50) + Math.max(-3, Math.min(3, dx[i] ?? 0)) * cool
      ys[i] = (ys[i] ?? 50) + Math.max(-3, Math.min(3, dy[i] ?? 0)) * cool
    }
  }
  // Fit into the ground with a margin for the pill itself.
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const fit = (v: number, lo: number, hi: number, from: number, to: number): number =>
    hi - lo < 1e-6 ? (from + to) / 2 : from + ((v - lo) / (hi - lo)) * (to - from)
  return xs.map((x, i) => ({
    x: Math.round(fit(x, minX, maxX, 14, 86) * 10) / 10,
    y: Math.round(fit(ys[i] ?? 50, minY, maxY, 16, 84) * 10) / 10,
  }))
}

/** Edge width: the mockup's `max(1.5, min(7, n / 3.2))`; a zero pair is a 1.5 dash. */
export const edgeWidth = (shared: number): number => (shared === 0 ? 1.5 : Math.max(1.5, Math.min(7, shared / 3.2)))

// ---------------------------------------------------------------------------
// The card, assembled
// ---------------------------------------------------------------------------

/** Everything a card, a row, a node and the drawer print about one record - `CastRow` plus the derived fields. */
export type CastFigure = CastRow & {
  readonly short: string
  readonly initial: string
  readonly group: CastGroup
  readonly perEpisode: readonly number[]
  readonly first: SceneRef | null
  readonly last: SceneRef | null
  /** The character's scenes as refs, script order. */
  readonly refs: readonly SceneRef[]
  readonly conflicts: readonly ResolveItem[]
}

/** The chip's letters: `M`, or `KM` for a two-word name the mockup shortens to two capitals. */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter((word) => word !== '')
  const first = words[0]?.[0]
  if (first === undefined) return '·'
  if (words.length >= 2 && /^(the|a|an)$/i.test(words[0] ?? '')) return (words[1]?.[0] ?? first).toUpperCase()
  return first.toUpperCase()
}

export const figuresOf = (
  cast: readonly CastRow[],
  index: readonly SceneRef[],
  episodeOrdinals: readonly number[],
  resolve: readonly ResolveItem[],
): readonly CastFigure[] => {
  const refs = new Map<NodeId, SceneRef>(index.map((ref) => [ref.sceneNodeId, ref]))
  const lead = leadOf(cast)
  const conflicts = conflictsOf(resolve)
  return cast.map((row) => {
    const ends = firstLast(row.scenes, refs)
    return {
      ...row,
      short: shortName(row.name),
      initial: initialsOf(row.name),
      group: groupOf(row.appearances, lead),
      perEpisode: perEpisode(row.scenes, refs, episodeOrdinals),
      first: ends?.first ?? null,
      last: ends?.last ?? null,
      refs: refsOf(row.scenes, refs),
      conflicts: conflicts.get(row.id) ?? [],
    }
  })
}
