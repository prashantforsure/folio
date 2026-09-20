import { CHARACTER_GENDER_LABELS } from '@folio/contracts'

import type { CastFigure } from './cast'

/**
 * The List view's arithmetic: sort, the optional columns, and the CSV a
 * writer takes out of the app. Pure; tested in `tests/characters-list.test.ts`.
 * The fourth pass's table (2026-09-20), from the Sheet's.
 *
 * Sort and the shown columns are component state - the URL stays
 * `/characters` (the route's views are client state by ruling, and a sort
 * key is smaller than a view). The CSV is built in the browser from the
 * rows on screen: it is not paginated, carries no comment, and leaves
 * nothing behind - so it needs no export path and no dependency.
 */

export type ListSortKey = 'name' | 'gender' | 'age' | 'role' | 'scenes' | 'lines' | 'words' | 'share' | `e${number}`

export type SortDirection = 'asc' | 'desc'

export type ListColumn = {
  readonly id: Exclude<ListSortKey, `e${number}`> | 'episodes'
  readonly title: string
  /** Off until the Display menu turns it on. */
  readonly optional: boolean
}

/** The six default columns, then the three the Display menu offers. */
export const LIST_COLUMNS: readonly ListColumn[] = [
  { id: 'name', title: 'Name', optional: false },
  { id: 'gender', title: 'Gender', optional: false },
  { id: 'age', title: 'Age', optional: false },
  { id: 'role', title: 'Role', optional: false },
  { id: 'scenes', title: 'Scenes', optional: false },
  { id: 'lines', title: 'Lines', optional: false },
  { id: 'words', title: 'Words', optional: true },
  { id: 'share', title: 'Share of dialogue', optional: true },
  { id: 'episodes', title: 'Episodes', optional: true },
]

export type OptionalColumn = Extract<ListColumn['id'], 'words' | 'share' | 'episodes'>

/** The direction a key starts in when first clicked: words read up, counts read down. */
export const defaultDirection = (key: ListSortKey): SortDirection =>
  key === 'name' || key === 'gender' || key === 'age' || key === 'role' ? 'asc' : 'desc'

/** A percentage, whole, never above 100; `0` with nothing to share. */
export const shareOf = (words: number, total: number): number =>
  total <= 0 ? 0 : Math.min(100, Math.round((words / total) * 100))

/** `40s` sorts after `38`: a numeric age by its number, any other text after every number, by text. */
const ageOrder = (age: string): { readonly n: number; readonly text: string } =>
  /^\d+$/.test(age.trim()) ? { n: Number(age), text: '' } : { n: Number.POSITIVE_INFINITY, text: age }

const compareBy = (key: ListSortKey, a: CastFigure, b: CastFigure): number => {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'gender':
      return (a.gender === null ? '' : CHARACTER_GENDER_LABELS[a.gender]).localeCompare(b.gender === null ? '' : CHARACTER_GENDER_LABELS[b.gender])
    case 'age': {
      const x = ageOrder(a.age ?? '')
      const y = ageOrder(b.age ?? '')
      return x.n - y.n || x.text.localeCompare(y.text)
    }
    case 'role':
      return (a.role ?? '').localeCompare(b.role ?? '')
    case 'scenes':
      return a.appearances - b.appearances
    case 'lines':
      return a.lines - b.lines
    case 'words':
      return a.words - b.words
    case 'share':
      return a.share - b.share
    default: {
      const ordinal = Number(key.slice(1))
      return (a.episodeScenes[ordinal - 1] ?? 0) - (b.episodeScenes[ordinal - 1] ?? 0)
    }
  }
}

/** Whether a figure has nothing under this key - drawn last whichever way the column sorts. */
const isEmptyUnder = (key: ListSortKey, figure: CastFigure): boolean => {
  switch (key) {
    case 'gender':
      return figure.gender === null
    case 'age':
      return figure.age === null || figure.age.trim() === ''
    case 'role':
      return figure.role === null || figure.role.trim() === ''
    default:
      return false
  }
}

/** Stable; empties last; the name breaks every tie so two equal counts do not reorder on a re-render. */
export const sortCast = (figures: readonly CastFigure[], key: ListSortKey, direction: SortDirection): readonly CastFigure[] =>
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

const cell = (value: string): string => (/[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value)

/**
 * The list as RFC 4180 text: a header, one row per figure as shown, `\r\n`
 * line ends. The six default columns always; Words and Share when the
 * Display menu shows them; `E1…En` when Episodes is shown, one column per
 * episode ordinal given.
 */
export const csvOf = (
  figures: readonly CastFigure[],
  shown: { readonly words: boolean; readonly share: boolean; readonly episodes: readonly number[] | null },
): string => {
  const header = [
    'Name',
    'Gender',
    'Age',
    'Role',
    'Scenes',
    'Lines',
    ...(shown.words ? ['Words'] : []),
    ...(shown.share ? ['Share'] : []),
    ...(shown.episodes ?? []).map((n) => `E${String(n)}`),
  ]
  const rows = figures.map((figure) => [
    figure.name,
    figure.gender === null ? '' : CHARACTER_GENDER_LABELS[figure.gender],
    figure.age ?? '',
    figure.role ?? '',
    String(figure.appearances),
    String(figure.lines),
    ...(shown.words ? [String(figure.words)] : []),
    ...(shown.share ? [`${String(figure.share)}%`] : []),
    ...(shown.episodes ?? []).map((n) => String(figure.episodeScenes[n - 1] ?? 0)),
  ])
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
