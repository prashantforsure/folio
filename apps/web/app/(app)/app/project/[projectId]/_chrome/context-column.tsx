import type { ReactNode } from 'react'

import { CONTEXT_PANEL_WIDTH } from '../../../../../../lib/workspace/routes'
import type { EpisodeNavRoute, WorkspaceRoute } from '../../../../../../lib/workspace/routes'

type ColumnRoute = Exclude<WorkspaceRoute, EpisodeNavRoute>

/**
 * The record-list / filter column a project route owns. The episode nav's
 * sibling, at the route's own width from the README's table: 256px for
 * Characters and Locations, 252px for Bible, 250px for Timeline, Research
 * and Production.
 *
 * Header row as in every bundle: the project title in Newsreader 15px/500.
 * Entity routes carry the find input on a `--sheet` ground with a `⌕` glyph
 * and the bundle's own placeholder. The list below is **empty in this
 * phase** - the record lists are route bodies, and route bodies are the next
 * phases' work. What is here is the column's geometry and its header, so
 * that when a list lands it lands in a column that already measures
 * correctly beside the rail.
 *
 * The `＋` the bundles draw in this header ("New character", "＋ thread") is
 * not rendered: each is a mutation on an entity that has no route body yet.
 */
export const ContextColumn = ({
  route,
  title,
  find,
  children,
}: {
  readonly route: ColumnRoute
  readonly title: string
  /** The find input's placeholder, where the bundle has one. */
  readonly find?: string
  readonly children?: ReactNode
}) => (
  <aside
    data-context-column={route}
    aria-label={`${title} records`}
    style={{ width: CONTEXT_PANEL_WIDTH[route] }}
    className="flex flex-none flex-col border-r border-line bg-panel"
  >
    <div className="flex items-center gap-[6px] pb-[8px] pl-[10px] pr-[10px] pt-[11px]">
      <span className="min-w-0 flex-1 truncate font-serif text-15 font-medium tracking-title">
        {title}
      </span>
    </div>

    {find === undefined ? null : (
      <div className="pb-[10px] pl-[10px] pr-[10px]">
        <label className="flex items-center gap-[7px] rounded-chrome border border-line2 bg-sheet pb-[5px] pl-[9px] pr-[9px] pt-[5px]">
          <span aria-hidden="true" className="text-11 text-ink3" style={{ fontFamily: 'var(--font-glyph)' }}>
            ⌕
          </span>
          <input
            type="search"
            placeholder={find}
            aria-label={find}
            className="min-w-0 flex-1 border-none bg-transparent text-11-5 text-ink outline-none placeholder:text-ink3"
          />
        </label>
      </div>
    )}

    <nav
      aria-label={`${title} list`}
      className="flex flex-1 flex-col gap-[10px] overflow-y-auto pb-[14px] pl-[6px] pr-[6px]"
    >
      {children}
    </nav>
  </aside>
)
