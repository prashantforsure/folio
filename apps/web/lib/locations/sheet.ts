import type { LocationRow, SceneRef } from '@folio/contracts'
import { LOCATION_STATUS_LABELS } from '@folio/contracts'
import type { Quadrant } from '@folio/script'
import { NO_QUADRANT, addQuadrants } from '@folio/script'

import { kindLabel, refLabel } from './view'

/**
 * The Sheet view's arithmetic: sort, episode scope, the totals row and the
 * CSV a location manager takes out of the app. Pure; tested in
 * `tests/locations-sheet.test.ts`. The shape the Characters sheet had
 * until its fourth pass (`lib/characters/list.ts` is what it became), over
 * a location's rows.
 *
 * Sort and scope are component state, like the toolbar's filter - the URL
 * stays `/locations`. A scoped sheet counts the record's scenes in one
 * episode from its own scene list, so every column but `Days` (a
 * scheduling fact, not per episode) narrows with it. The CSV is built in
 * the browser from the rows on screen: it is not paginated, carries no
 * comment, and leaves nothing behind - so it needs no export path and no
 * dependency.
 */

export type SortKey =
  | 'name'
  | 'kind'
  | 'status'
  | 'scenes'
  | 'ie'
  | 'day'
  | 'night'
  | 'pages'
  | 'days'
  | 'cast'
  | 'first'
  | 'last'
  | `e${number}`

export type SortDirection = 'asc' | 'desc'

/** The direction a key starts in when first clicked: names and kinds read up, counts read down. */
export const defaultDirection = (key: SortKey): SortDirection =>
  key === 'name' || key === 'kind' || key === 'status' || key === 'ie' || key === 'first' || key === 'last' ? 'asc' : 'desc'

/** A record's numbers under one episode, or the whole run when `ordinal` is null. */
export type ScopedFigures = {
  readonly scenes: number
  readonly quadrant: Quadrant
  readonly day: number
  readonly night: number
  /** Eighths summed over the measured scenes in scope; null when none is measured. */
  readonly eighths: number | null
  readonly first: SceneRef | null
  readonly last: SceneRef | null
}

const refOrder = (a: SceneRef | null, b: SceneRef | null): number => {
  if (a === null || b === null) return 0
  return a.episodeOrdinal - b.episodeOrdinal || a.number - b.number
}

export const scopeOf = (row: LocationRow, ordinal: number | null): ScopedFigures => {
  if (ordinal === null) {
    return {
      scenes: row.rollup.scenes,
      quadrant: row.rollupQuadrant,
      day: row.rollupQuadrant.intDay + row.rollupQuadrant.extDay,
      night: row.rollupQuadrant.intNight + row.rollupQuadrant.extNight,
      eighths: row.eighths,
      first: row.firstSeen,
      last: row.lastSeen,
    }
  }
  const scenes = row.scenes.filter((scene) => scene.scene.episodeOrdinal === ordinal)
  let quadrant = NO_QUADRANT
  let eighths: number | null = null
  for (const scene of scenes) {
    const lit = scene.light === 'unspecified'
    quadrant = addQuadrants(quadrant, {
      intDay: !lit && scene.ie === 'INT' && scene.light === 'day' ? 1 : 0,
      intNight: !lit && scene.ie === 'INT' && scene.light === 'night' ? 1 : 0,
      extDay: !lit && scene.ie !== 'INT' && scene.light === 'day' ? 1 : 0,
      extNight: !lit && scene.ie !== 'INT' && scene.light === 'night' ? 1 : 0,
      unlit: lit ? 1 : 0,
    })
    if (scene.eighths !== null) eighths = (eighths ?? 0) + scene.eighths
  }
  return {
    scenes: scenes.length,
    quadrant,
    day: quadrant.intDay + quadrant.extDay,
    night: quadrant.intNight + quadrant.extNight,
    eighths,
    first: scenes[0]?.scene ?? null,
    last: scenes.at(-1)?.scene ?? null,
  }
}

const compareBy = (key: SortKey, a: LocationRow, b: LocationRow, ordinal: number | null): number => {
  const x = scopeOf(a, ordinal)
  const y = scopeOf(b, ordinal)
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'kind':
      return kindLabel(a).localeCompare(kindLabel(b))
    case 'status':
      return LOCATION_STATUS_LABELS[a.status].localeCompare(LOCATION_STATUS_LABELS[b.status])
    case 'scenes':
      return x.scenes - y.scenes
    case 'ie':
      return (a.ie ?? '').localeCompare(b.ie ?? '')
    case 'day':
      return x.day - y.day
    case 'night':
      return x.night - y.night
    case 'pages':
      return (x.eighths ?? 0) - (y.eighths ?? 0)
    case 'days':
      return a.rollup.shootingDays - b.rollup.shootingDays
    case 'cast':
      return a.people.length - b.people.length
    case 'first':
      return refOrder(x.first, y.first)
    case 'last':
      return refOrder(x.last, y.last)
    default: {
      const at = Number(key.slice(1))
      return (a.perEpisode[at - 1] ?? 0) - (b.perEpisode[at - 1] ?? 0)
    }
  }
}

/** Whether a row has nothing under this key - drawn last whichever way the column sorts. */
const isEmptyUnder = (key: SortKey, row: LocationRow, ordinal: number | null): boolean => {
  switch (key) {
    case 'ie':
      return row.ie === null
    case 'pages':
      return scopeOf(row, ordinal).eighths === null
    case 'first':
      return scopeOf(row, ordinal).first === null
    case 'last':
      return scopeOf(row, ordinal).last === null
    case 'days':
      return row.rollup.shootingDays === 0
    default:
      return false
  }
}

/** Stable; empties last; the name breaks every tie so two equal counts do not reorder on a re-render. */
export const sortRows = (rows: readonly LocationRow[], key: SortKey, direction: SortDirection, ordinal: number | null): readonly LocationRow[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((p, q) => {
      const pEmpty = isEmptyUnder(key, p.row, ordinal)
      const qEmpty = isEmptyUnder(key, q.row, ordinal)
      if (pEmpty !== qEmpty) return pEmpty ? 1 : -1
      const primary = compareBy(key, p.row, q.row, ordinal) * (direction === 'asc' ? 1 : -1)
      return primary || p.row.name.localeCompare(q.row.name) || p.index - q.index
    })
    .map((entry) => entry.row)

export type SheetTotals = {
  readonly scenes: number
  readonly day: number
  readonly night: number
  readonly eighths: number | null
  readonly days: number
  readonly perEpisode: readonly number[]
}

/**
 * The totals row. Primary sets only, so a scene under a sub-set is counted
 * once (the parent's roll-up already holds it); a sub-set whose parent is
 * not on the sheet - filtered out - counts for itself.
 */
export const totalsOf = (rows: readonly LocationRow[], ordinal: number | null, episodeOrdinals: readonly number[]): SheetTotals => {
  const shown = new Set(rows.map((row) => row.id))
  const roots = rows.filter((row) => row.parentId === null || !shown.has(row.parentId))
  let eighths: number | null = null
  const totals = { scenes: 0, day: 0, night: 0, days: 0, perEpisode: episodeOrdinals.map(() => 0) }
  for (const row of roots) {
    const in_ = scopeOf(row, ordinal)
    totals.scenes += in_.scenes
    totals.day += in_.day
    totals.night += in_.night
    totals.days += row.rollup.shootingDays
    if (in_.eighths !== null) eighths = (eighths ?? 0) + in_.eighths
    episodeOrdinals.forEach((n, index) => {
      totals.perEpisode[index] = (totals.perEpisode[index] ?? 0) + (row.perEpisode[n - 1] ?? 0)
    })
  }
  return { ...totals, eighths }
}

const cell = (value: string): string => (/[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value)

const eighthsCsv = (value: number | null): string => (value === null ? '' : `${String(Math.floor(value / 8))} ${String(value % 8)}/8`)

/**
 * The Sheet as RFC 4180 text: a header, one row per record as shown, `\\r\\n`
 * line ends. `episodeOrdinals` gives the `E1…En` columns; a scoped sheet
 * passes the one episode it shows.
 */
export const csvOf = (rows: readonly LocationRow[], ordinal: number | null, episodeOrdinals: readonly number[]): string => {
  const header = [
    'Location',
    'Part of',
    'Type',
    'Status',
    'Address',
    'Scenes',
    'INT/EXT',
    'INT D',
    'INT N',
    'EXT D',
    'EXT N',
    'Unlit',
    'Pages',
    'Shooting days',
    'Roll-up days',
    'Cast',
    ...episodeOrdinals.map((n) => `E${String(n)}`),
    'First',
    'Last',
    'Sluglines',
  ]
  const lines = rows.map((row) => {
    const in_ = scopeOf(row, ordinal)
    return [
      row.name,
      row.parent?.name ?? '',
      kindLabel(row),
      LOCATION_STATUS_LABELS[row.status],
      row.address ?? '',
      String(in_.scenes),
      row.ie ?? '',
      String(in_.quadrant.intDay),
      String(in_.quadrant.intNight),
      String(in_.quadrant.extDay),
      String(in_.quadrant.extNight),
      String(in_.quadrant.unlit),
      eighthsCsv(in_.eighths),
      String(row.scheduledDays),
      String(row.rollup.shootingDays),
      row.people.map((person) => person.name).join('; '),
      ...episodeOrdinals.map((n) => String(row.perEpisode[n - 1] ?? 0)),
      in_.first === null ? '' : refLabel(in_.first),
      in_.last === null ? '' : refLabel(in_.last),
      row.sluglines.map((entry) => `${entry.slugline} x${String(entry.occurrences)}`).join('; '),
    ]
  })
  return [header, ...lines].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}

/**
 * One set's breakdown as CSV - the `Scenes here` section's export: a row
 * per scene at the set or below, in reading order.
 */
export const breakdownCsvOf = (row: LocationRow): string => {
  const header = ['Scene', 'INT/EXT', 'Light', 'Time of day', 'Story day', 'Clock', 'Flashback', 'Heading', 'Set', 'Synopsis', 'Cast', 'Eighths']
  const lines = row.scenes.map((scene) => [
    refLabel(scene.scene),
    scene.ie,
    scene.light === 'unspecified' ? '' : scene.light,
    scene.timeOfDay ?? '',
    scene.storyDay === null ? '' : String(scene.storyDay),
    scene.storyClock ?? '',
    scene.flashback ? 'yes' : '',
    scene.scene.heading,
    scene.at.name,
    scene.gist ?? '',
    scene.cast.map((person) => person.name).join('; '),
    scene.eighths === null ? '' : String(scene.eighths),
  ])
  return [header, ...lines].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}
