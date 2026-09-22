import type { ReactNode } from 'react'

import { ThemeToggle } from './theme-toggle'

/**
 * The main column of every account route: a 60px header over the surface
 * card, and nothing else.
 *
 * `handoff-account-v2/README.md`, "Shared shell": "Main column: 60px header
 * with breadcrumb + right-side actions, then the rounded surface panel." The
 * panel is `.folio-surface` - `--s1`, a `--line2` hairline, `18px 0 0 0` on
 * the top-left corner alone and a backdrop blur - the same class the nine
 * workspace routes draw, because it is the same surface.
 *
 * **The surface owns the scrolling.** The frame is `overflow: hidden` and the
 * panel scrolls inside it, which is what keeps the header and the sidebar
 * still while a long list moves. A route that needs its own sticky strip (the
 * Projects toolbar) takes `head` or `foot`, which sit outside the scrolling
 * area rather than inside it; a route with two columns that scroll
 * differently (Settings: a nav beside a body, a save bar under the body
 * alone) passes `scroll={false}` and owns the whole inside of the panel.
 *
 * The theme toggle is the header's right-hand slot on every route, as the
 * handoff draws it: a 34px round outline button.
 */
export const RouteFrame = ({
  crumbs,
  actions,
  head,
  foot,
  scroll = true,
  children,
}: {
  /** The breadcrumb, left to right. The last is the page; the ones before it are quiet. */
  readonly crumbs: readonly string[]
  readonly actions?: ReactNode
  /** A fixed strip inside the surface, above the scrolling area. */
  readonly head?: ReactNode
  /** A fixed strip inside the surface, below it. */
  readonly foot?: ReactNode
  /** False when the route lays out the panel's inside itself. */
  readonly scroll?: boolean
  readonly children: ReactNode
}) => (
  <main className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex h-[60px] flex-none items-center gap-[10px] pl-[6px] pr-[14px]">
      <div className="flex min-w-0 flex-1 items-center gap-[7px] overflow-hidden text-13">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <span key={crumb} className="flex min-w-0 items-center gap-[7px]">
              {index === 0 ? null : <span className="text-ink3">/</span>}
              {last ? (
                <h1 className="m-0 truncate text-13 font-normal">{crumb}</h1>
              ) : (
                <span className="whitespace-nowrap text-ink3">{crumb}</span>
              )}
            </span>
          )
        })}
      </div>
      {actions}
      <ThemeToggle variant="circle" />
    </header>

    <div className="folio-surface flex min-h-0 flex-1 flex-col">
      {head}
      {scroll ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      ) : (
        children
      )}
      {foot}
    </div>
  </main>
)
