import type { SceneFacts, SceneRef } from '@folio/contracts'
import { CHARACTER_STATUS_LABELS } from '@folio/contracts'

import type { CastFigure } from './cast'
import { formatSceneRef } from './figures'

/**
 * The Sheet view's arithmetic: sort, episode scope, and the CSV a writer
 * takes out of the app. Pure; tested in `tests/characters-sheet.test.ts`.
 *
 * Sort and scope are component state, like the toolbar's filter - the URL
 * stays `/characters` (the route's views are client state by ruling, and a
 * sort key is smaller than a view). The CSV is built in the browser from the
 * rows on screen: it is not paginated, carries no comment, and leaves
 * nothing behind - so it needs no export path and no dependency.
 */

export type SortKey =
  | 'name'
  | 'role'
  | 'speaks'
  | 'mentioned'
  | 'lines'
  | 'words'
  | 'share'
  | 'intro'
  | 'eighths'
  | 'first'
  | 'last'
  | `e${number}`

export type SortDirection = 'asc' | 'desc'

/** The direction a key starts in when first clicked: names read up, counts read down. */
export const defaultDirection = (key: SortKey): SortDirection => (key === 'name' || key === 'role' ? 'asc' : 'desc')

const refOrder = (a: SceneRef | null, b: SceneRef | null): number => {
  // Nulls last in either direction is handled by the caller; here both are refs.
  if (a === null || b === null) return 0
  return a.episodeOrdinal - b.episodeOrdinal || a.number - b.number
}

/** The introducing scene as a ref, for the `Intro` column; null with none or when the scene left the index. */
export const introRefOf = (figure: CastFigure): SceneRef | null => {
  const scene = figure.introducedAt?.sceneNodeId ?? null
  return scene === null ? null : (figure.refs.find((ref) => ref.sceneNodeId === scene) ?? null)
}

/** Eighths summed over the character's measured scenes; null when none is measured. */
export const eighthsOf = (figure: CastFigure): number | null => {
  let total = 0
  let any = false
  for (const ref of figure.refs) {
    if (ref.eighths === null) continue
    any = true
    total += ref.eighths
  }
  return any ? total : null
}

const compareBy = (key: SortKey, a: CastFigure, b: CastFigure): number => {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'role':
      return (a.role ?? '').localeCompare(b.role ?? '')
    case 'speaks':
      return a.speaks - b.speaks
    case 'mentioned':
      return a.mentionedIn - b.mentionedIn
    case 'lines':
      return a.lines - b.lines
    case 'words':
      return a.words - b.words
    case 'share':
      return a.share - b.share
    case 'intro':
      return refOrder(introRefOf(a), introRefOf(b))
    case 'eighths':
      return (eighthsOf(a) ?? 0) - (eighthsOf(b) ?? 0)
    case 'first':
      return refOrder(a.first, b.first)
    case 'last':
      return refOrder(a.last, b.last)
    default: {
      const ordinal = Number(key.slice(1))
      return (a.perEpisode[ordinal - 1] ?? 0) - (b.perEpisode[ordinal - 1] ?? 0)
    }
  }
}

/** Whether a figure has nothing under this key - drawn last whichever way the column sorts. */
const isEmptyUnder = (key: SortKey, figure: CastFigure): boolean => {
  switch (key) {
    case 'role':
      return figure.role === null
    case 'first':
      return figure.first === null
    case 'last':
      return figure.last === null
    case 'intro':
      return introRefOf(figure) === null
    case 'eighths':
      return eighthsOf(figure) === null
    default:
      return false
  }
}

/** Stable; empties last; the name breaks every tie so two equal counts do not reorder on a re-render. */
export const sortFigures = (
  figures: readonly CastFigure[],
  key: SortKey,
  direction: SortDirection,
): readonly CastFigure[] =>
  figures
    .map((figure, index) => ({ figure, index }))
    .sort((x, y) => {
      const xEmpty = isEmptyUnder(key, x.figure)
      const yEmpty = isEmptyUnder(key, y.figure)
      if (xEmpty !== yEmpty) return xEmpty ? 1 : -1
      const primary = compareBy(key, x.figure, y.figure) * (direction === 'asc' ? 1 : -1)
      return primary || x.figure.name.localeCompare(y.figure.name) || x.index - y.index
    })
    .map((entry) => entry.figure)

/**
 * The figure's numbers under one episode, or the whole run when `ordinal`
 * is null: scenes spoken in and mentioned in, words, the share against
 * every dialogue word under that episode's headings, and the span.
 */
export const scopeOf = (
  figure: CastFigure,
  ordinal: number | null,
  index: readonly SceneFacts[],
  episodeOrdinals: readonly number[],
): {
  readonly speaks: number
  readonly mentioned: number
  readonly words: number
  readonly share: number
  readonly first: SceneRef | null
  readonly last: SceneRef | null
} => {
  if (ordinal === null) {
    return { speaks: figure.speaks, mentioned: figure.mentionedIn, words: figure.words, share: figure.share, first: figure.first, last: figure.last }
  }
  const refs = figure.refs.filter((ref) => ref.episodeOrdinal === ordinal)
  const at = episodeOrdinals.indexOf(ordinal)
  const words = at < 0 ? 0 : (figure.episodeWords[at] ?? 0)
  const total = index.filter((scene) => scene.episodeOrdinal === ordinal).reduce((sum, scene) => sum + scene.words, 0)
  return {
    speaks: refs.filter((ref) => ref.speaking.includes(figure.id)).length,
    mentioned: refs.filter((ref) => !ref.speaking.includes(figure.id) && ref.mentioned.includes(figure.id)).length,
    words,
    share: total === 0 ? 0 : Math.min(100, Math.round((words / total) * 100)),
    first: refs[0] ?? null,
    last: refs.at(-1) ?? null,
  }
}

const cell = (value: string): string => (/[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value)

/**
 * The Sheet as RFC 4180 text: a header, one row per figure as shown, `\r\n`
 * line ends. `episodeOrdinals` gives the `E1…En` columns; a scoped sheet
 * passes the one episode it shows.
 */
export const csvOf = (figures: readonly CastFigure[], episodeOrdinals: readonly number[]): string => {
  const header = [
    'Name',
    'Role',
    'Status',
    'Speaks',
    'Mentioned',
    'Lines',
    'Words',
    'Share',
    ...episodeOrdinals.map((n) => `E${String(n)}`),
    'Intro',
    'Eighths',
    'First',
    'Last',
  ]
  const rows = figures.map((figure) => {
    const intro = introRefOf(figure)
    const eighths = eighthsOf(figure)
    return [
      figure.name,
      figure.role ?? '',
      CHARACTER_STATUS_LABELS[figure.status],
      String(figure.speaks),
      String(figure.mentionedIn),
      String(figure.lines),
      String(figure.words),
      `${String(figure.share)}%`,
      ...episodeOrdinals.map((n) => String(figure.perEpisode[n - 1] ?? 0)),
      intro === null ? '' : formatSceneRef(intro),
      eighths === null ? '' : String(eighths),
      figure.first === null ? '' : formatSceneRef(figure.first),
      figure.last === null ? '' : formatSceneRef(figure.last),
    ]
  })
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
