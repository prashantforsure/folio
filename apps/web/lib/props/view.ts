import type { PropRow, PropStatus, SceneRef } from '@folio/contracts'
import { PROP_STATUS_LABELS } from '@folio/contracts'

/**
 * The derived lines the Props route prints, each a pure function over the
 * rows the loader joins. Tested in `tests/props-view.test.ts`.
 *
 * Nothing here estimates and nothing calls a model. A count is a count of
 * lines the script actually writes; `Sourced 4 of 6` is a count of
 * statuses; a category chip is a value somebody typed. AGENTS.md, UI
 * fidelity: every number is computed from the script or from a row.
 */

// ---------------------------------------------------------------------------
// Counts and labels
// ---------------------------------------------------------------------------

/** `9 scenes`, `1 scene`, or the README's line for a claim with no ref. */
export const sceneLabel = (scenes: number): string =>
  scenes === 0 ? 'Not on the page yet' : scenes === 1 ? '1 scene' : `${String(scenes)} scenes`

/** `12 lines`, `1 line`, `no lines`. What the evidence section's head counts. */
export const lineLabel = (lines: number): string =>
  lines === 0 ? 'no lines' : lines === 1 ? '1 line' : `${String(lines)} lines`

/** `E1 Sc 4`, as every scene reference on the route reads. */
export const refLabel = (ref: SceneRef): string => `E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`

/**
 * The card's mono line: `Hand prop · 4 scenes`, or just the count with no
 * category, or the no-ref line when the page never writes about it.
 */
export const metaLine = (row: Pick<PropRow, 'category' | 'scenes'>): string => {
  const scenes = row.scenes.length === 0 ? 'Not on the page yet' : sceneLabel(row.scenes.length)
  return row.category === null ? scenes : `${row.category} · ${scenes}`
}

/**
 * The drawer's head: `12 lines across 4 scenes · first in E1 Sc 3`, or the
 * no-ref line. `lines` is the uncapped total, so the head does not lie
 * about a prop whose quotations were capped.
 */
export const metaLong = (row: Pick<PropRow, 'lines' | 'scenes' | 'firstSeen'>): string => {
  if (row.lines === 0) return 'Not on the page yet'
  const first = row.firstSeen === null ? '' : ` · first in ${refLabel(row.firstSeen)}`
  return `${lineLabel(row.lines)} across ${sceneLabel(row.scenes.length)}${first}`
}

/**
 * `Needed for 3 shots` - what Production already asks of this record, the
 * two `prop_id` columns read back. Empty string when nothing does, so the
 * caller can drop the line rather than print a zero.
 */
export const productionLine = (row: Pick<PropRow, 'shots' | 'sceneSetups'>): string => {
  const parts: string[] = []
  if (row.shots.length > 0) parts.push(`${String(row.shots.length)} ${row.shots.length === 1 ? 'shot' : 'shots'}`)
  if (row.sceneSetups > 0) parts.push(`${String(row.sceneSetups)} ${row.sceneSetups === 1 ? 'scene setup' : 'scene setups'}`)
  return parts.length === 0 ? '' : `Needed for ${parts.join(' · ')}`
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = 'warn' | 'ok' | 'accent'

/**
 * The README's "Status as a dot plus a pill", read for these three: amber
 * for `needed` (a decision waiting), green for `sourced` (settled), accent
 * for `on set` - the Locations route's mapping, one word at a time.
 */
export const statusTone = (status: PropStatus): Tone =>
  status === 'needed' ? 'warn' : status === 'sourced' ? 'ok' : 'accent'

export const statusLabel = (status: PropStatus): string => PROP_STATUS_LABELS[status]

/** The sidebar widget's second row: `4 of 6`. `sourced` and `on set` both count as got hold of. */
export const sourcedLine = (rows: readonly { readonly status: PropStatus }[]): string => {
  const got = rows.filter((row) => row.status !== 'needed').length
  return `${String(got)} of ${String(rows.length)}`
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * The sidebar groups by **category**, not by status: a category is what a
 * writer has actually sorted their props into, and the status is already a
 * dot on every row. Records with no category fall into one trailing group,
 * named rather than left blank.
 */
export const UNCATEGORISED = 'Uncategorised'

export const grouped = <Row extends { readonly category: string | null }>(
  rows: readonly Row[],
): readonly { readonly group: string; readonly rows: readonly Row[] }[] => {
  const names: string[] = []
  const byGroup = new Map<string, Row[]>()
  for (const row of rows) {
    const group = row.category ?? UNCATEGORISED
    const found = byGroup.get(group)
    if (found === undefined) {
      names.push(group)
      byGroup.set(group, [row])
    } else found.push(row)
  }
  // First-appearance order, except that the unnamed group always sits last.
  const named = names.filter((name) => name !== UNCATEGORISED).sort((a, b) => a.localeCompare(b))
  const order = byGroup.has(UNCATEGORISED) ? [...named, UNCATEGORISED] : named
  return order.flatMap((group) => {
    const here = byGroup.get(group)
    return here === undefined || here.length === 0 ? [] : [{ group, rows: here as readonly Row[] }]
  })
}

/**
 * Every category the project already uses, sorted, blanks dropped - what
 * the drawer's category field offers. Ruling 5: free text, offered from
 * what exists, never an enum. A value the writer types that is not in the
 * list is simply a new category.
 */
export const categoriesOf = (rows: readonly { readonly category: string | null }[]): readonly string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const value = row.category?.trim() ?? ''
    if (value === '' || seen.has(value.toLowerCase())) continue
    seen.add(value.toLowerCase())
    out.push(value)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

// ---------------------------------------------------------------------------
// Filters and search
// ---------------------------------------------------------------------------

/** The toolbar's `All props ▾`: the whole list, or one status. */
export type StatusFilter = 'all' | PropStatus

export const FILTER_LABELS: Readonly<Record<StatusFilter, string>> = {
  all: 'All props',
  needed: 'Needed',
  sourced: 'Sourced',
  'on set': 'On set',
}

export const passesFilter = (row: Pick<PropRow, 'status'>, filter: StatusFilter): boolean =>
  filter === 'all' || row.status === filter

/** The sidebar's find field: a name, a category or any bound alias, case-folded. */
export const matchesFind = (row: Pick<PropRow, 'name' | 'category' | 'aliases'>, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  if (row.name.toLowerCase().includes(needle)) return true
  if ((row.category ?? '').toLowerCase().includes(needle)) return true
  return row.aliases.some((alias) => alias.toLowerCase().includes(needle))
}

// ---------------------------------------------------------------------------
// The list view's sort
// ---------------------------------------------------------------------------

/** The List view's two sortable columns, each either way - the `⇅` on the header. */
export type SortKey = 'name' | 'category'

export type Sort = { readonly key: SortKey; readonly descending: boolean }

export const DEFAULT_SORT: Sort = { key: 'name', descending: false }

/**
 * The rows in the table's order. A blank category sorts last whichever way
 * the column points - an absent value is not "before A", it is absent -
 * and the name is the tie-break, so the order is total and a re-render
 * cannot reshuffle equal rows.
 */
export const sorted = <Row extends Pick<PropRow, 'name' | 'category'>>(rows: readonly Row[], sort: Sort): readonly Row[] => {
  const direction = sort.descending ? -1 : 1
  return [...rows].sort((a, b) => {
    if (sort.key === 'category') {
      const left = a.category ?? ''
      const right = b.category ?? ''
      if (left === '' && right !== '') return 1
      if (right === '' && left !== '') return -1
      const by = left.localeCompare(right) * direction
      if (by !== 0) return by
    }
    return a.name.localeCompare(b.name) * direction
  })
}

// ---------------------------------------------------------------------------
// The status bar
// ---------------------------------------------------------------------------

/** The status bar's left: `6 props · 29 scenes · Game Ball`. */
export const statusLeft = (rows: readonly PropRow[], sceneTotal: number, selected: PropRow | null): string => {
  const props = `${String(rows.length)} ${rows.length === 1 ? 'prop' : 'props'}`
  const scenes = `${String(sceneTotal)} ${sceneTotal === 1 ? 'scene' : 'scenes'}`
  return selected === null ? `${props} · ${scenes}` : `${props} · ${scenes} · ${selected.name}`
}

/** The status bar's mono route id: `props`, or `props/3f2a9c1e` - the record's UUID prefix. */
export const routeIdOf = (selected: { readonly id: string } | null): string =>
  selected === null ? 'props' : `props/${selected.id.slice(0, 8)}`

/** A stable hue for a record's mark - the Locations route's, over a prop's id. */
export const hueOf = (id: string): number => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/**
 * What a sidebar row prints: the row minus the evidence and the rest the
 * list never reads.
 *
 * Here, not in the `'use client'` sidebar module, for the reason
 * `sidebarRowOf` is in `lib/locations/view.ts`: the layout is a Server
 * Component and maps the loader's rows through it, and a function exported
 * from a `'use client'` module cannot be *called* from the server, only
 * rendered. That crashed the Locations route once (the user walk,
 * 2026-09-16).
 */
export type PropSidebarRow = Pick<PropRow, 'id' | 'name' | 'category' | 'status' | 'aliases' | 'lines'> & {
  readonly scenes: number
}

export const sidebarRowOf = (row: PropRow): PropSidebarRow => ({
  id: row.id,
  name: row.name,
  category: row.category,
  status: row.status,
  aliases: row.aliases,
  lines: row.lines,
  scenes: row.scenes.length,
})
