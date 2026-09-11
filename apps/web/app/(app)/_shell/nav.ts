import type { GlyphName, UnspecifiedGlyphName } from '@folio/ui'
import type { Route } from 'next'

/**
 * The sidebar. **Exactly four items, in this order.**
 *
 * New · Recents · Screenwriting · Filmmaking.
 *
 * ## What is deliberately not here
 *
 * **Trash** is reached from the project list. **Account settings** is reached
 * from the avatar menu. Neither is a sidebar item, and adding one is not a
 * small improvement - it is the difference between a sidebar that is four
 * things a writer does and a sidebar that is a list of every page.
 *
 * **Community, the writing leaderboard and the activity heatmap are cut** and
 * are not to be built. AGENTS.md, Constraints: "Cut, do not build". **The
 * credits card is also cut** - AGENTS.md puts credits in the Production header,
 * "where they are spent", and a credit balance in the chrome of a screenwriting
 * app is an invitation to think about money while writing.
 *
 * ## The glyphs, and the one that is not in AGENTS.md's set
 *
 * `recents ◷`, `screenwriting ✎` and `filmmaking ▶` are from the specified
 * eighteen and carry the meaning they carry in the rail - `✎` is Writing, `▶`
 * is Production.
 *
 * **`new` uses `＋`, which is a nineteenth character.** AGENTS.md lists
 * eighteen and none of them reads as "create". `＋` is U+FF0B FULLWIDTH PLUS
 * SIGN, taken from `Route - Script.dc.html`'s "New episode" button, so it is at
 * least transcribed from a bundle rather than invented - but it is outside the
 * set the contract writes down and a human should confirm it. It is exported
 * from `@folio/ui` as `UNSPECIFIED_GLYPHS`, separately from `GLYPHS`, so the
 * eighteen stay countable.
 *
 * ## The `as Route` assertions are gone
 *
 * The previous phase carried four of them because none of these routes
 * existed. They do now - `app/(app)/app/{new,recents,screenwriting,filmmaking}`
 * - so `Route` includes all four and every `href` below is checked by the
 * compiler against a page that is actually there. The `unbuilt` flag went with
 * them.
 */

export type SidebarItem = {
  readonly label: string
  readonly href: Route
  readonly glyph: GlyphName | UnspecifiedGlyphName
}

export const SIDEBAR: readonly SidebarItem[] = [
  { label: 'New', href: '/app/new', glyph: 'create' },
  { label: 'Recents', href: '/app/recents', glyph: 'timeline' },
  { label: 'Screenwriting', href: '/app/screenwriting', glyph: 'writing' },
  { label: 'Filmmaking', href: '/app/filmmaking', glyph: 'production' },
]

/** Reached from the avatar menu, never the sidebar. */
export const ACCOUNT_SETTINGS: Route = '/app/settings'

/** Reached from the project list header, never the sidebar. */
export const TRASH: Route = '/app/trash'
