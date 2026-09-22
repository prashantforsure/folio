import type { IconName } from '@folio/ui'
import type { Route } from 'next'

/**
 * The home sidebar. **Exactly four rows, in this order.**
 *
 * New · Projects · Trash · Settings.
 *
 * ## What changed, and what did not
 *
 * The four rows used to be New · Recents · Screenwriting · Filmmaking, with
 * Trash reached from the list header and account settings from the avatar
 * menu (`nav.ts`, which the project workspace's rail still uses). The client
 * ruled the account routes over on 2026-09-22: **Recents became Projects**,
 * the two kind routes became filter chips on it, and Trash and Settings came
 * into the sidebar. `/app/recents`, `/app/screenwriting` and `/app/filmmaking`
 * redirect here and are kept so an old link, a bookmark and
 * `workspaceHref`'s filmmaking branch all still land somewhere real.
 *
 * What did not change: **Community, the writing leaderboard and the activity
 * heatmap are still cut** (AGENTS.md, Constraints) and the sidebar is still
 * four rows rather than a list of every page. The search field the previous
 * handoff drew is gone with it - the palette it would open is not built, and a
 * field that opens nothing is a placeholder.
 *
 * ## The count beside Projects
 *
 * A live count of live, unarchived projects - the same number the `All` chip
 * on the route shows, read from the same query. AGENTS.md, UI fidelity:
 * "Badges are live counts, never placeholders."
 *
 * ## Icons
 *
 * Inline stroke SVGs from `@folio/ui` (`icons.tsx`), the handoff's own paths:
 * `plus` for New, `grid` for Projects, `trash` for Trash, `gear` for Settings.
 * The older Unicode glyph set is not used on these routes.
 */

export type HomeNavItem = {
  readonly label: string
  readonly href: Route
  readonly icon: IconName
  /** Projects carries the live count; the others carry nothing. */
  readonly counted?: true
}

export const HOME_NAV: readonly HomeNavItem[] = [
  { label: 'New', href: '/app/new', icon: 'plus' },
  { label: 'Projects', href: '/app/projects', icon: 'grid', counted: true },
  { label: 'Trash', href: '/app/trash', icon: 'trash' },
  { label: 'Settings', href: '/app/settings', icon: 'gear' },
]

/** Where a project list lives now. The three old paths redirect to it. */
export const PROJECTS: Route = '/app/projects'
