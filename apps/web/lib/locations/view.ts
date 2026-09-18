import type { LocationKind, LocationRow, LocationSceneRow, LocationStatus, SceneRef } from '@folio/contracts'
import { LOCATION_STATUS_LABELS } from '@folio/contracts'
import type { InteriorExterior, LocationId, Quadrant } from '@folio/script'
import type { PresenceGroup } from '@folio/ui'

import { eighths } from '../workspace/format'

/**
 * The derived fields the Locations route prints, each a pure function over
 * the rows the loader joins - first read off the v2 mockup's `data()`, then
 * (the rebuild, 2026-09-18 - the plan is the spec) the lines the writer
 * and the filmmaker actually read: the quadrant, the story day, the
 * presence strip, the alias table's counts. Tested in
 * `tests/locations-view.test.ts`.
 *
 * Nothing here estimates and nothing calls a model. A kind is read off the
 * tree and a scene count; a group is the kind; a conflict is an open row in
 * the resolve queue; `Scouted 4 / 6` is a count of statuses. AGENTS.md, UI
 * fidelity: every number is "computed from the script".
 */

// ---------------------------------------------------------------------------
// Kind
// ---------------------------------------------------------------------------

/**
 * The mockup authors `kind` (`Primary set`, `Recurring exterior`,
 * `One-off`); here it is read: a record with sub-sets is a primary set, a
 * record under one is inside it, and the rest are recurring, one-off, or -
 * AGENTS.md's "0 appearances · record kept" - not on the page yet.
 */
export const kindOf = (row: { readonly parentId: LocationId | null; readonly children: number; readonly rollup: { readonly scenes: number } }): LocationKind => {
  if (row.children > 0) return 'primary'
  if (row.parentId !== null) return 'sub'
  if (row.rollup.scenes === 0) return 'off-page'
  return row.rollup.scenes === 1 ? 'one-off' : 'recurring'
}

const IE_WORD: Readonly<Record<InteriorExterior, string>> = {
  INT: 'interior',
  EXT: 'exterior',
  'INT/EXT': 'set',
  EST: 'establishing set',
}

/**
 * The kind as the card's mono line and the sheet's `Type` column print it:
 * `Primary set`, `Inside Kamathi Chawl`, `Recurring exterior`, `One-off`,
 * `Not on the page yet` - the README's line for a claim with no ref.
 */
export const kindLabel = (row: Pick<LocationRow, 'kind' | 'ie' | 'parent'>): string => {
  switch (row.kind) {
    case 'primary':
      return 'Primary set'
    case 'sub':
      return row.parent === null ? 'Sub-set' : `Inside ${row.parent.name}`
    case 'recurring':
      return row.ie === null ? 'Recurring' : `Recurring ${IE_WORD[row.ie]}`
    case 'one-off':
      return 'One-off'
    case 'off-page':
      return 'Not on the page yet'
  }
}

/** `INT/EXT · Primary set` - the card tile's second line. `—` for a record with no heading. */
export const ieKindLine = (row: Pick<LocationRow, 'kind' | 'ie' | 'parent'>): string =>
  `${row.ie ?? '—'} · ${kindLabel(row)}`

// ---------------------------------------------------------------------------
// Counts and labels
// ---------------------------------------------------------------------------

/** `9 scenes`, `1 scene`, or the README's line for a claim with no ref. */
export const sceneLabel = (scenes: number): string =>
  scenes === 0 ? 'Not on the page yet' : scenes === 1 ? '1 scene' : `${String(scenes)} scenes`

/** `9 scenes · 41 2/8 pp` - the card's meta line; just the README's line when there is no scene. */
export const metaLine = (row: Pick<LocationRow, 'rollup' | 'eighths'>): string =>
  row.rollup.scenes === 0 ? sceneLabel(0) : `${sceneLabel(row.rollup.scenes)} · ${eighths(row.eighths)} pp`

/** `E1 Sc 1`, as every scene reference on the route reads. */
export const refLabel = (ref: SceneRef): string => `E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`

/** `E1 · 1` - the "Scenes here" row's ref, the mockup's spelling. */
export const shortRef = (ref: SceneRef): string => `E${String(ref.episodeOrdinal)} · ${String(ref.number)}`

/** `9 scenes · 41 2/8 pages · first in E1 Sc 1` - the drawer's head. */
export const metaLong = (row: Pick<LocationRow, 'rollup' | 'eighths' | 'firstSeen'>): string => {
  if (row.rollup.scenes === 0) return sceneLabel(0)
  const pages = row.eighths === null ? '' : ` · ${eighths(row.eighths)} ${row.eighths === 8 ? 'page' : 'pages'}`
  const first = row.firstSeen === null ? '' : ` · first in ${refLabel(row.firstSeen)}`
  return `${sceneLabel(row.rollup.scenes)}${pages}${first}`
}

/** `4 d · 5 n` - the sheet's Day / Night column. */
export const dayNightLabel = (counts: { readonly dayScenes: number; readonly nightScenes: number }): string =>
  `${String(counts.dayScenes)} d · ${String(counts.nightScenes)} n`

/** `4 D · 5 N` - the card's and the sidebar row's split, from the quadrant. `—` with no lit heading. */
export const dayNightShort = (quadrant: Quadrant): string => {
  const day = quadrant.intDay + quadrant.extDay
  const night = quadrant.intNight + quadrant.extNight
  return day + night === 0 ? '—' : `${String(day)} D · ${String(night)} N`
}

/** `INT · 4 D · 5 N` - the sidebar row's second line; `—` for a record with no heading. */
export const sidebarLine = (row: { readonly ie: InteriorExterior | null; readonly rollupQuadrant: Quadrant }): string =>
  row.ie === null ? '—' : `${row.ie} · ${dayNightShort(row.rollupQuadrant)}`

/** The breakdown's four boxes as the section head and the drawer print them, zeros included - a count that is one. */
export const QUADRANT_BOXES: readonly { readonly key: keyof Quadrant; readonly label: string }[] = [
  { key: 'intDay', label: 'INT D' },
  { key: 'intNight', label: 'INT N' },
  { key: 'extDay', label: 'EXT D' },
  { key: 'extNight', label: 'EXT N' },
]

/** `INT D 3 · INT N 2 · EXT D 1 · EXT N 3`, plus ` · 1 unlit` when a heading says neither. */
export const quadrantLabel = (quadrant: Quadrant): string => {
  const boxes = QUADRANT_BOXES.map((box) => `${box.label} ${String(quadrant[box.key])}`)
  return quadrant.unlit === 0 ? boxes.join(' · ') : `${boxes.join(' · ')} · ${String(quadrant.unlit)} unlit`
}

/** `Day 3 · 09:40 · flashback` - the Timeline's story time beside a scene row; empty when none was set. */
export const storyTimeLabel = (row: Pick<LocationSceneRow, 'storyDay' | 'storyClock' | 'flashback'>): string =>
  [row.storyDay === null ? null : `Day ${String(row.storyDay)}`, row.storyClock, row.flashback ? 'flashback' : null]
    .filter((part): part is string => part !== null)
    .join(' · ')

/** `2 days · roll-up 5` when the subtree has more; `2 days` when it is all this set; `—` with none. */
export const daysLabel = (own: number, rollup: number): string => {
  if (rollup === 0) return '—'
  const days = `${String(own)} ${own === 1 ? 'day' : 'days'}`
  return rollup === own ? days : `${days} · roll-up ${String(rollup)}`
}

/** `15 in the script` - the drawer's slugline note; the README's line with none. */
export const sluglineNote = (sluglines: readonly { readonly occurrences: number }[]): string => {
  const total = sluglines.reduce((sum, row) => sum + row.occurrences, 0)
  return total === 0 ? 'Not on the page yet' : `${String(total)} in the script`
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = 'warn' | 'ok' | 'accent'

/** README, "Status as a dot plus a pill": amber pending, green scouted, accent locked. */
export const statusTone = (status: LocationStatus): Tone =>
  status === 'pending' ? 'warn' : status === 'scouted' ? 'ok' : 'accent'

export const statusLabel = (status: LocationStatus): string => LOCATION_STATUS_LABELS[status]

/** The sidebar widget: `Scouted 4 / 6`, the bar, `2 still pending`. */
export const scoutedOf = (
  rows: readonly { readonly status: LocationStatus }[],
): { readonly scouted: number; readonly total: number; readonly percent: number; readonly note: string } => {
  const total = rows.length
  const scouted = rows.filter((row) => row.status !== 'pending').length
  const pending = total - scouted
  return {
    scouted,
    total,
    percent: total === 0 ? 0 : Math.round((scouted / total) * 100),
    note: total === 0 ? 'No locations yet' : pending === 0 ? 'Nothing still pending' : `${String(pending)} still pending`,
  }
}

/** `Scouted · 4 of 6` - the widget's second row, from `scoutedOf`. */
export const scoutedLine = (rows: readonly { readonly status: LocationStatus }[]): string => {
  const scouted = scoutedOf(rows)
  return `${String(scouted.scouted)} of ${String(scouted.total)}`
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * The sidebar's groups - the mockup's `Primary set · Recurring · One-off`,
 * plus the README's line for records with no scene. A primary set's sub-sets
 * sit under it in its group, in tree order, so the tree stays readable in a
 * flat list.
 */
export type LocationGroup = 'primary' | 'recurring' | 'one-off' | 'off-page'

export const LOCATION_GROUPS: readonly LocationGroup[] = ['primary', 'recurring', 'one-off', 'off-page']

export const LOCATION_GROUP_LABELS: Readonly<Record<LocationGroup, string>> = {
  primary: 'Primary set',
  recurring: 'Recurring',
  'one-off': 'One-off',
  'off-page': 'Not on the page yet',
}

/** Which group a row lists under: a sub-set goes with its parent's. */
export const groupOf = (row: Pick<LocationRow, 'kind' | 'parentId'>, rows: readonly Pick<LocationRow, 'id' | 'kind' | 'parentId'>[]): LocationGroup => {
  if (row.kind === 'sub') {
    const parent = rows.find((entry) => entry.id === row.parentId)
    return parent === undefined ? 'off-page' : groupOf(parent, rows)
  }
  return row.kind
}

export const grouped = <Row extends Pick<LocationRow, 'id' | 'kind' | 'parentId'>>(
  rows: readonly Row[],
): readonly { readonly group: LocationGroup; readonly rows: readonly Row[] }[] =>
  LOCATION_GROUPS.flatMap((group) => {
    const here = rows.filter((row) => groupOf(row, rows) === group)
    return here.length === 0 ? [] : [{ group, rows: here }]
  })

// ---------------------------------------------------------------------------
// Filters and search
// ---------------------------------------------------------------------------

/** The toolbar's `All locations ▾`: the whole list, or one status. */
export type StatusFilter = 'all' | LocationStatus

export const FILTER_LABELS: Readonly<Record<StatusFilter, string>> = {
  all: 'All locations',
  pending: 'Pending',
  scouted: 'Scouted',
  locked: 'Locked',
}

export const passesFilter = (row: Pick<LocationRow, 'status'>, filter: StatusFilter): boolean =>
  filter === 'all' || row.status === filter

/** The sidebar's find field: a name, or any counted or bound set text, case-folded. */
export const matchesFind = (row: Pick<LocationRow, 'name' | 'sluglines' | 'boundSluglines'>, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  if (row.name.toLowerCase().includes(needle)) return true
  if (row.sluglines.some((entry) => entry.slugline.toLowerCase().includes(needle))) return true
  return row.boundSluglines.some((entry) => entry.toLowerCase().includes(needle))
}

// ---------------------------------------------------------------------------
// The banner
// ---------------------------------------------------------------------------

/** `3 sluglines don't point at a location` - the banner's line. */
export const unmatchedLabel = (count: number): string =>
  count === 1 ? "1 slugline doesn't point at a location" : `${String(count)} sluglines don't point at a location`

/** The status bar's left: `6 locations · 29 scenes · Kamathi Chawl`. */
export const statusLeft = (rows: readonly LocationRow[], sceneTotal: number, selected: LocationRow | null): string => {
  const places = `${String(rows.length)} ${rows.length === 1 ? 'location' : 'locations'}`
  const scenes = `${String(sceneTotal)} ${sceneTotal === 1 ? 'scene' : 'scenes'}`
  return selected === null ? `${places} · ${scenes}` : `${places} · ${scenes} · ${selected.name}`
}

/** A stable hue for a record's gradient tile - the mockup authors one per place; here it is the id's. */
export const hueOf = (id: string): number => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

// ---------------------------------------------------------------------------
// The presence strip
// ---------------------------------------------------------------------------

/**
 * Every present scene in the project as the strip's cells, grouped by
 * episode: `full` where the scene is at this set or below, `none`
 * elsewhere - a set has no half presence. The cell's title is the scene's
 * ref and heading, so a hover names the scene.
 */
export const stripGroupsOf = (
  here: ReadonlySet<string>,
  index: readonly SceneRef[],
  episodes: readonly { readonly ordinal: number }[],
): readonly PresenceGroup[] =>
  episodes
    .map((episode) => ({
      label: episodes.length > 1 ? `E${String(episode.ordinal)}` : '',
      cells: index
        .filter((ref) => ref.episodeOrdinal === episode.ordinal)
        .map((ref) => ({
          key: ref.sceneNodeId,
          state: here.has(ref.sceneNodeId) ? ('full' as const) : ('none' as const),
          title: `${refLabel(ref)}${ref.heading === '' ? '' : ` · ${ref.heading}`}${here.has(ref.sceneNodeId) ? ' · here' : ''}`,
        })),
    }))
    .filter((group) => group.cells.length > 0)

/** The longest run of scenes the set is away for, when it is five or more; the drawer's gap line. */
export const GAP_SCENES = 5

export const longestGap = (
  here: ReadonlySet<string>,
  index: readonly SceneRef[],
): { readonly scenes: number; readonly from: SceneRef; readonly to: SceneRef } | null => {
  let best: { scenes: number; from: SceneRef; to: SceneRef } | null = null
  let last: SceneRef | null = null
  let run = 0
  for (const ref of index) {
    if (here.has(ref.sceneNodeId)) {
      if (last !== null && run >= GAP_SCENES && (best === null || run > best.scenes)) best = { scenes: run, from: last, to: ref }
      last = ref
      run = 0
      continue
    }
    if (last !== null) run += 1
  }
  return best
}

// ---------------------------------------------------------------------------
// The queue and the status bar
// ---------------------------------------------------------------------------

/** Past this many open rows the queue folds to the first five with `Show all N`. */
export const QUEUE_FOLD = 5

/** The status bar's mono route id: `locations`, or `locations/3f2a9c1e` - the record's UUID prefix. */
export const routeIdOf = (selected: { readonly id: string } | null): string =>
  selected === null ? 'locations' : `locations/${selected.id.slice(0, 8)}`

/** `INT. TANK ROOM is Kamathi Chawl's now.` and the rest of the queue's toasts. */
export const decisionToast = (slugline: string, decision: { readonly kind: 'bound'; readonly name: string } | { readonly kind: 'new-record' }): string =>
  decision.kind === 'bound' ? `${slugline} is ${decision.name}'s now.` : `${slugline} is a new location.`

/**
 * What a sidebar row prints: the row minus the scene list and the rest the
 * list never reads (`_locations/location-sidebar.tsx`). Here, not in that
 * file, because the layout - a Server Component - maps the loader's rows
 * through it, and a function exported from a `'use client'` module cannot
 * be *called* from the server, only rendered (found 2026-09-16 in the user
 * walk: "Locations route crashes"; moved 2026-09-17).
 */
export type LocationSidebarRow = Pick<LocationRow, 'id' | 'name' | 'ie' | 'status' | 'kind' | 'parentId' | 'depth' | 'rollup' | 'rollupQuadrant' | 'sluglines' | 'boundSluglines'>

export const sidebarRowOf = (row: LocationRow): LocationSidebarRow => ({
  id: row.id,
  name: row.name,
  ie: row.ie,
  status: row.status,
  kind: row.kind,
  parentId: row.parentId,
  depth: row.depth,
  rollup: row.rollup,
  rollupQuadrant: row.rollupQuadrant,
  sluglines: row.sluglines,
  boundSluglines: row.boundSluglines,
})
