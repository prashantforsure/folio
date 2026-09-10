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
 * ## Why `as Route`, and when it deletes itself
 *
 * `next.config.ts` sets `typedRoutes: true`, which types `href` as a union of
 * routes that actually exist. **None of these four exist yet** - this phase
 * builds auth, tokens and chrome, and the brief is explicit that "Sidebar links
 * point at them; they can 404 for now."
 *
 * So the assertion is here, in one file, on four lines, rather than at four
 * call sites. It is a single assertion and not the banned `as unknown as`
 * (AGENTS.md, Conventions > Typing), and it is genuinely temporary: the moment
 * `app/(app)/app/new/page.tsx` exists, `Route` includes `/app/new` and the
 * assertion becomes a no-op that can be deleted. Until then it is the honest
 * shape of the situation - a link to something that is not built - rather than
 * a config flag turned off to hide it.
 */

export type SidebarItem = {
  readonly label: string
  readonly href: Route
  readonly glyph: GlyphName | UnspecifiedGlyphName
  /** True while these routes do not exist. Rendered with a `title` that says so. */
  readonly unbuilt: boolean
}

export const SIDEBAR: readonly SidebarItem[] = [
  { label: 'New', href: '/app/new' as Route, glyph: 'create', unbuilt: true },
  { label: 'Recents', href: '/app/recents' as Route, glyph: 'timeline', unbuilt: true },
  { label: 'Screenwriting', href: '/app/screenwriting' as Route, glyph: 'writing', unbuilt: true },
  { label: 'Filmmaking', href: '/app/filmmaking' as Route, glyph: 'production', unbuilt: true },
]

/** Reached from the avatar menu, never the sidebar. Also not built yet. */
export const ACCOUNT_SETTINGS = '/app/settings' as Route
