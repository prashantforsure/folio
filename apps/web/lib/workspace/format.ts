import type { EpisodeNavMeta } from '@folio/contracts'

import type { EpisodeNavRoute } from './routes'

/**
 * How the chrome prints a fact. Pure, and tested in `tests/workspace-format.test.ts`.
 *
 * AGENTS.md, UI fidelity: "things that legitimately count to zero show `0`;
 * things that either exist or don't show `—`; the script says `empty`." The
 * three forms are three functions below, and every nav meta goes through one
 * of them. A value is never written into a component: the component calls
 * `navMeta(route, meta)` and gets a string it did not compose.
 */

/** The dash for a thing that either exists or does not. U+2014, as the bundles draw it. */
export const ABSENT = '—'

/** A count that may legitimately be zero. `0` is a real answer. */
export const count = (value: number): string => String(value)

/** A count of something that may not exist at all. `null` is `—`, never `0`. */
export const countOrAbsent = (value: number | null, suffix = ''): string =>
  value === null ? ABSENT : `${String(value)}${suffix}`

/**
 * The six episode nav metas, from the brief's table:
 *
 *   Script      `104pp` / `empty`     the script says `empty`
 *   Outline     `3 acts` / `—`        exists or not
 *   Storyboard  `38 shots` / `—`      exists or not
 *   Scenes      `34` / `0`            counts to zero
 *   Revisions   `Draft 5` / `—`       exists or not
 *   Notes       `4 open` / `0`        counts to zero
 *
 * One state the table does not name: a script that exists but has never been
 * measured. It is not `empty` - there is a script - and it has no page count,
 * which is a thing that either exists or does not, so it prints `—`. Flagged
 * in the phase report; the row is `countOrAbsent`, so the one that changes is
 * this comment.
 */
export const navMeta = (route: EpisodeNavRoute, meta: EpisodeNavMeta): string => {
  switch (route) {
    case 'script':
      return meta.script === 'absent' ? 'empty' : countOrAbsent(meta.script.pages, 'pp')
    case 'outline':
      return meta.acts === null ? ABSENT : `${String(meta.acts)} ${meta.acts === 1 ? 'act' : 'acts'}`
    case 'storyboard':
      return meta.shots === null
        ? ABSENT
        : `${String(meta.shots)} ${meta.shots === 1 ? 'shot' : 'shots'}`
    case 'scenes':
      return count(meta.scenes)
    case 'revisions':
      return meta.draft === null ? ABSENT : `Draft ${String(meta.draft)}`
    case 'notes':
      return `${String(meta.openNotes)}${meta.openNotes === 0 ? '' : ' open'}`
  }
}

/**
 * Eighths of a page, as a production office writes them: `2/8`, `1 4/8`,
 * `2 1/8`. Whole pages first, then the remainder over eight - and the eight is
 * never reduced, because `4/8` is what the breakdown sheet says and `1/2`
 * is not.
 *
 * Zero eighths is `0/8`: a measured scene that occupies no lines is a real
 * measurement, not an absence. `null` is the absence.
 */
export const eighths = (value: number | null): string => {
  if (value === null) return ABSENT
  const pages = Math.floor(value / 8)
  const rest = value % 8
  if (pages === 0) return `${String(rest)}/8`
  if (rest === 0) return `${String(pages)}`
  return `${String(pages)} ${String(rest)}/8`
}

/**
 * The project chip's initials: `ML` for Monsoon Line, `Fo` for Folio.
 *
 * Two words give their first letters; one word gives its first two, keeping
 * the second's case, which is how the bundle prints the shell chip. The same
 * rule as `initialsFrom` for a person, except that a one-word project title
 * still yields two characters, because a 28px chip with one letter reads as
 * a category, not a name.
 */
export const projectInitials = (title: string): string => {
  const words = title.trim().split(/\s+/).filter((word) => word.length > 0)
  const first = words[0]
  if (first === undefined) return '??'
  const second = words[1]
  const chars = [...first]
  if (second !== undefined) return `${chars[0] ?? ''}${[...second][0] ?? ''}`.toUpperCase()
  return `${(chars[0] ?? '').toUpperCase()}${chars[1] ?? ''}`
}

/** `E1`, `E12`. The episode board's number column. */
export const episodeNumber = (ordinal: number): string => `E${String(ordinal)}`

/** `Ep 1 · Standpipe`. The group label above the six rows. */
export const episodeGroupLabel = (ordinal: number, title: string): string =>
  `Ep ${String(ordinal)} · ${title}`
