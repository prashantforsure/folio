import type { ReactNode } from 'react'

import { loadProduction } from '../../../../../../lib/production/server'
import { coverageRows, episodeStats } from '../../../../../../lib/production/view'
import { loadShareLink } from '../../../../../../lib/share/server'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { ProductionSidebarGroup, ProductionSidebarWidget } from '../_production/sidebar-slots'
import { Sidebar } from './sidebar'
import { WritingHeader } from './writing-header'

/**
 * Production's shell, in both URL shapes - the same three parts every
 * route wears (`docs/ui design/README.md`, "Shell"): the sidebar card, the
 * header, the main-surface card the route body sits in. `_chrome/writing-layout.tsx`
 * for a route outside the writing surface: the header is told its route
 * (no Write / Storyboard pill, a third crumb), and the sidebar takes this
 * route's two slots - `Scenes from script` and `Episode frames`
 * (`_production/sidebar-slots.tsx`) - in place of the writing rows.
 *
 * `/production` is **episode-scoped** - AGENTS.md open decision 5, ruled by
 * the client and recorded in `docs/build-decisions.md`. Reels and frames
 * were always episode-scoped; the ruling put the route beside them.
 *
 * The rows that seed the sidebar come from `loadProduction`, the same
 * `cache()`d read the page makes, so the layout adds no query of its own.
 */
export const ProductionLayout = async ({
  projectId,
  episodeId,
  children,
}: {
  readonly projectId: string
  readonly episodeId: string | null
  readonly children: ReactNode
}) => {
  const context = await loadEpisode(projectId, episodeId)
  const [share, load] = await Promise.all([loadShareLink(context.scope), loadProduction(context)])
  const scenes = load.state === 'script' ? load.scenes : []
  const input =
    load.state === 'script'
      ? { available: load.balance.available, frameCost: load.costs.frame, renderCost: load.costs.render, resolution: load.resolution }
      : { available: load.balance.available, frameCost: 0, renderCost: 0, resolution: load.resolution }
  return (
    <>
      <Sidebar
        context={context}
        slots={{
          group: <ProductionSidebarGroup initialRows={coverageRows(scenes, input)} />,
          widget: <ProductionSidebarWidget initialStats={episodeStats(scenes)} />,
        }}
      />
      <div data-writing-column className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col">
        <WritingHeader
          projectId={context.project.id}
          projectTitle={context.project.title}
          shape={context.shape}
          route="production"
          episodes={context.episodes.map((episode) => ({
            slug: episode.slug,
            ordinal: episode.ordinal,
            title: episode.title,
          }))}
          current={{ slug: context.episode.slug, ordinal: context.episode.ordinal, title: context.episode.title }}
          share={share}
        />
        <div data-surface className="folio-surface flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </div>
      </div>
    </>
  )
}
