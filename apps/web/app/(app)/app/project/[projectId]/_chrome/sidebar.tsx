import { FRAME_GENERATION_COST } from '@folio/contracts'
import { listEpisodeScenes, readBalance, readBoardCoverage, readEpisodeNavMeta } from '@folio/db'
import type { ReactNode } from 'react'

import { loadOutlineToc } from '../../../../../../lib/outline/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { navMeta } from '../../../../../../lib/workspace/format'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import { SIDEBAR, SIDEBAR_WIDTH } from '../../../../../../lib/workspace/routes'
import { EpisodeTitleRow } from './episode-title-row'
import { SidebarGroup } from './sidebar-group'
import { SidebarRows } from './sidebar-rows'
import { SidebarWidget } from './sidebar-widget'

/**
 * The writing sidebar. **236px**, a floating `--s1` card with a 16px radius
 * - `docs/ui design/README.md`, "Sidebar": "project name and a `+`, a
 * recessed search field, the grouped item list, and one summary widget
 * pinned to the bottom."
 *
 * The Script mockup, top to bottom: the episode's name and `+` (new
 * episode), the three rows - Script, Outline, Scenes - with a meta each, the
 * Scenes group with a count and one row per scene (number, heading in mono
 * uppercase, eighths), and the Credits card. No search field: the palette
 * it would open is not built, and a field that opens nothing is a
 * placeholder. No episode board: switching episodes is the header's
 * breadcrumb since the redesign; naming one is this card's title row
 * (`episode-title-row.tsx` - the name renames, `+` creates).
 *
 * ## The second group and the widget are the route's
 *
 * The Outline mockup lists `In this outline` where the others list
 * `Scenes`; the Storyboard mockup lists `Boards` and counts `Boards drawn`
 * where the others count credits. A layout cannot see which route renders
 * below it, so the group (`sidebar-group.tsx`) and the widget
 * (`sidebar-widget.tsx`) are Client Components that read the segment and
 * pick; every list is read here and handed down. The outline's headings
 * come through `loadOutlineToc`, whose document read is the one the
 * Outline page makes (`cache()`d in `lib/outline/server.ts`), so on that
 * route the list costs no second query; on the other three it is one
 * extra read of a page or two of blocks, in parallel with the rest. The
 * board's coverage is `readBoardCoverage`, one statement of counts, in
 * parallel too - not the whole board, which is three.
 *
 * ## Every value on this card is read, none is written
 *
 *   the three metas  `readEpisodeNavMeta` - `104pp` / `—` / `empty` / `0`
 *                    through `lib/workspace/format.ts`
 *   scenes           `listEpisodeScenes` - `scene_derivations` with
 *                    `measurement_scenes.eighths`
 *   headings         `loadOutlineToc` - the outline's `h1` / `h2` / `h3`
 *                    blocks, live on the Outline route (`lib/outline/toc.ts`)
 *   boards           `readBoardCoverage` - accepted, proposed and drawn per
 *                    scene, live on the Storyboard route
 *                    (`lib/storyboard/coverage.ts`)
 *   credits          `readBalance` - the ledger, summed; never stored
 *
 * ## A scene row is a link to its heading
 *
 * `#n-<node id>` on the script's URL. On the Script route the block carries
 * that `id`, so the row scrolls the editor to the heading (Next's router
 * scrolls a same-page hash); from Outline or Scenes it opens the script
 * there. A fragment, not a query param - nothing here names a scene in the
 * address (AGENTS.md open decision 10).
 *
 * ## The credits card is back
 *
 * AGENTS.md, Constraints listed the sidebar credits card under "cut, do not
 * build". The v2 design draws it on every writing route and the client ruled
 * for the design (2026-09-16). It is the same per-project balance the
 * Production header spends; the caption says what a credit buys today.
 *
 * ## Production wears the same card with its own two slots
 *
 * `Route - Production v2.dc.html` draws this sidebar without the three
 * rows: the title row, then `Scenes from script` (one row per scene with
 * a progress bar), then the `Episode frames` widget. A layout that *is*
 * the route hands both in as `slots` and this card draws them in place of
 * the segment-driven group and widget, reading nothing the route does not
 * need - the rows' metas, the outline and the board stay unread there.
 *
 * Characters (project-scoped) takes the same two slots and two more:
 * `title` - the project's name with `+ New character`, in place of the
 * episode's row - and `find`, the README's "recessed search field" the
 * Characters mockup draws under it (`Find a character`) and the writing
 * mockups do not. `aria-label`s follow: the card is the route's list, not
 * an episode's.
 */
export const Sidebar = async ({
  context,
  slots,
}: {
  readonly context: EpisodeContext
  /** A route's own group and widget, in place of the writing sidebar's. Production; Characters adds its title row and find field. */
  readonly slots?: {
    readonly group: ReactNode
    readonly widget: ReactNode
    readonly title?: ReactNode
    readonly find?: ReactNode
    /** The list's accessible name: `Cast`. Default `Episode scenes`. */
    readonly label?: string
  }
}) => {
  const { scope, project, episode, address, shape } = context
  const title = shape === 'episodic' ? (
    <EpisodeTitleRow
      projectId={project.id}
      slug={episode.slug}
      ordinal={episode.ordinal}
      title={episode.title}
      nextOrdinal={(context.episodes.at(-1)?.ordinal ?? 0) + 1}
    />
  ) : (
    <div className="flex flex-none items-center gap-[6px] pb-[10px] pl-[12px] pr-[12px] pt-[14px]">
      <span className="min-w-0 flex-1 truncate text-14 font-medium tracking-title">{project.title}</span>
    </div>
  )

  if (slots !== undefined) {
    return (
      <aside
        data-sidebar
        aria-label={slots.title === undefined ? 'Episode' : project.title}
        style={{ width: SIDEBAR_WIDTH }}
        className="relative z-[2] flex min-h-0 flex-none flex-col pb-[10px] pr-[10px] pt-[10px]"
      >
        <div className="folio-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
          {slots.title ?? title}
          {slots.find}
          <nav aria-label={slots.label ?? 'Episode scenes'} className="flex min-h-0 flex-1 flex-col gap-[4px] overflow-y-auto px-[8px] pb-[12px]">
            {slots.group}
          </nav>
          <div className="flex-none px-[10px] pb-[12px] pt-[10px]">{slots.widget}</div>
        </div>
      </aside>
    )
  }

  const [meta, scenes, balance, toc, coverage] = await Promise.all([
    readEpisodeNavMeta(scope, episode.id, project.format),
    listEpisodeScenes(scope, episode.id, project.format),
    readBalance(scope),
    loadOutlineToc(scope, episode),
    readBoardCoverage(scope, episode.id),
  ])

  const rows = SIDEBAR.map((item) => ({
    route: item.route,
    label: item.label,
    meta: navMeta(item.route, meta),
    href: episodeRouteHref(address, item.route),
  }))
  const scriptHref = episodeRouteHref(address, 'script')
  const frames = Math.max(0, Math.floor(balance.available / FRAME_GENERATION_COST))
  const share = balance.settled > 0 ? Math.max(0, Math.min(1, balance.available / balance.settled)) : 0

  return (
    <aside
      data-sidebar
      aria-label="Episode"
      style={{ width: SIDEBAR_WIDTH }}
      className="relative z-[2] flex min-h-0 flex-none flex-col pb-[10px] pr-[10px] pt-[10px]"
    >
      <div className="folio-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
        {title}

        <nav aria-label="Episode routes" className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[8px] pb-[12px]">
          <SidebarRows rows={rows} />

          <SidebarGroup
            scenes={scenes}
            scriptHref={scriptHref}
            title={episode.title}
            initialToc={toc === null ? null : toc.map((heading) => ({ id: heading.id as string, text: heading.text, level: heading.level }))}
            initialCoverage={coverage}
          />
        </nav>

        <div className="flex-none px-[10px] pb-[12px] pt-[10px]">
          <SidebarWidget credits={{ available: balance.available, share, frames }} initialCoverage={coverage} />
        </div>
      </div>
    </aside>
  )
}
