import { FRAME_GENERATION_COST } from '@folio/contracts'
import { listEpisodeScenes, readBalance, readEpisodeNavMeta } from '@folio/db'

import { loadOutlineToc } from '../../../../../../lib/outline/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { navMeta } from '../../../../../../lib/workspace/format'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import { SIDEBAR, SIDEBAR_WIDTH } from '../../../../../../lib/workspace/routes'
import { EpisodeTitleRow } from './episode-title-row'
import { SidebarGroup } from './sidebar-group'
import { SidebarRows } from './sidebar-rows'

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
 * ## The second group is the route's
 *
 * The Outline mockup lists `In this outline` where the others list
 * `Scenes`. A layout cannot see which route renders below it, so the group
 * is a Client Component (`sidebar-group.tsx`) that reads the segment and
 * picks; both lists are read here and handed down. The outline's headings
 * come through `loadOutlineToc`, whose document read is the one the
 * Outline page makes (`cache()`d in `lib/outline/server.ts`), so on that
 * route the list costs no second query; on the other three it is one
 * extra read of a page or two of blocks, in parallel with the rest.
 *
 * ## Every value on this card is read, none is written
 *
 *   the three metas  `readEpisodeNavMeta` - `104pp` / `—` / `empty` / `0`
 *                    through `lib/workspace/format.ts`
 *   scenes           `listEpisodeScenes` - `scene_derivations` with
 *                    `measurement_scenes.eighths`
 *   headings         `loadOutlineToc` - the outline's `h1` / `h2` / `h3`
 *                    blocks, live on the Outline route (`lib/outline/toc.ts`)
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
 */
export const Sidebar = async ({ context }: { readonly context: EpisodeContext }) => {
  const { scope, project, episode, address, shape } = context
  const [meta, scenes, balance, toc] = await Promise.all([
    readEpisodeNavMeta(scope, episode.id, project.format),
    listEpisodeScenes(scope, episode.id, project.format),
    readBalance(scope),
    loadOutlineToc(scope, episode),
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
        {shape === 'episodic' ? (
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
        )}

        <nav aria-label="Episode routes" className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[8px] pb-[12px]">
          <SidebarRows rows={rows} />

          <SidebarGroup
            scenes={scenes}
            scriptHref={scriptHref}
            title={episode.title}
            initialToc={toc === null ? null : toc.map((heading) => ({ id: heading.id as string, text: heading.text, level: heading.level }))}
          />
        </nav>

        <div className="flex-none px-[10px] pb-[12px] pt-[10px]">
          <div data-credits-card className="flex flex-col gap-[7px] rounded-card border border-line2 bg-s1 px-[12px] py-[11px]">
            <div className="flex items-baseline justify-between">
              <span className="text-12 text-ink2">Credits</span>
              <span className="tabular text-13 font-medium">{balance.available.toLocaleString('en-US')}</span>
            </div>
            <div className="h-[4px] overflow-hidden rounded-[3px] bg-s3">
              <div className="h-full rounded-[3px] bg-accent" style={{ width: `${String(Math.round(share * 100))}%` }} />
            </div>
            <span className="text-11 text-ink3">
              ≈ {frames.toLocaleString('en-US')} {frames === 1 ? 'frame' : 'frames'} · no expiry
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
