import type { ReactNode } from 'react'

/**
 * The page header. 46px, `0 14px`, 1px bottom border `--line`.
 *
 * Geometry and type are `Route - Script.dc.html`'s, which wins every chrome
 * disagreement (AGENTS.md, Feature workflow 1): route title in **Newsreader
 * 21px/500 at -.01em**. The six shell-route observations in
 * `docs/ui design/Route - New|Recents|….dc.html` draw the same 46px header
 * with a 15px title; the 21px is kept because the Script bundle is the ruling
 * and because these six routes are the same product as the fourteen.
 *
 * `aside` is the 10.5px `--ink3` line the observations put beside the title -
 * "All projects, most recently edited first" - which is a good pattern: it is
 * where a list says what it is a list of. `actions` is the right-hand slot.
 * `badge` is the count chip the Scenes bundle draws after the title: `1px 6px`,
 * `--sel`, 10px/600 `--ink2`, tabular. A live count, never a placeholder.
 *
 * A Server Component. Nothing here is interactive, so nothing here ships.
 */
export const PageHeader = ({
  title,
  badge,
  aside,
  actions,
}: {
  readonly title: string
  readonly badge?: string
  readonly aside?: string
  readonly actions?: ReactNode
}) => (
  <header className="flex h-[46px] flex-none items-center gap-[10px] border-b border-line px-[14px]">
    <h1 className="m-0 font-serif text-21 font-medium tracking-title">{title}</h1>
    {badge === undefined ? null : (
      <span className="tabular rounded-chrome bg-sel px-[6px] py-[1px] text-10 font-semibold text-ink2">
        {badge}
      </span>
    )}
    {aside === undefined ? null : (
      <p className="m-0 min-w-0 flex-1 truncate text-10-5 text-ink3">{aside}</p>
    )}
    {aside === undefined ? <div className="flex-1" /> : null}
    {actions}
  </header>
)
