import type { ReactNode } from 'react'

import { loadResearch } from '../../../../../../lib/research/server'
import { loadShareLink } from '../../../../../../lib/share/server'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import { CollectionsGroup, FiledWidget, ResearchTitleRow } from '../_research/research-sidebar'
import { SourceDrawer } from '../_research/source-drawer'
import { FindField, FindProvider } from './find-field'
import { Sidebar } from './sidebar'
import { WritingHeader } from './writing-header'

/**
 * The Research route's shell - the three parts every route wears
 * (`docs/ui design/README.md`, "Shell"), on `characters-layout.tsx`'s
 * pattern: the sidebar card with this route's four slots
 * (`_research/research-sidebar.tsx`), the header told its route (no Write /
 * Storyboard pill: Research is "outside the writing surface"; the crumb is
 * `Project / Research`, no episode - the route is project-scoped), and the
 * main-surface card the page body sits in.
 *
 * ## The drawer is nobody's page
 *
 * `Route - Research v2.dc.html` opens one drawer for `Edit` on a source and
 * for `＋ Add source` from the toolbar, the sidebar's `+`, the grid's dashed
 * card and the empty card. Which source it edits is not the URL - the URL
 * names the source being *read* - so the drawer is a cell
 * (`lib/research/compose.ts`) and mounts here, once, where every door can
 * reach it; it portals into the slot after the column (`#research-drawer`,
 * `_chrome/drawer-shell.tsx`) so it sits beside the header, full height,
 * in flow above 1200px as the mockup draws it.
 *
 * ## One read
 *
 * `loadResearch` is `cache()`d on the project context; the page makes the
 * same call, so the layout adds no query of its own. `loadEpisode` with no
 * segment is the shell's "last opened, else first" - the shared `Sidebar`
 * takes an episode context this route never prints.
 */
export const ResearchLayout = async ({ projectId, children }: { readonly projectId: string; readonly children: ReactNode }) => {
  const context = await loadEpisode(projectId, null)
  const [share, load] = await Promise.all([loadShareLink(context.scope), loadResearch(context)])
  const baseHref = projectRouteHref(context.project.id, 'research')

  return (
    <FindProvider>
      <Sidebar
        context={context}
        slots={{
          title: <ResearchTitleRow title={context.project.title} />,
          find: load.sources.length === 0 ? null : <FindField placeholder="Search sources and clips" testId="research-find" />,
          group: <CollectionsGroup collections={load.collections} total={load.sources.length} baseHref={baseHref} />,
          widget: <FiledWidget clips={load.clips} />,
          label: 'Collections',
        }}
      />
      <div data-writing-column className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col">
        <WritingHeader
          projectId={context.project.id}
          projectTitle={context.project.title}
          shape={context.shape}
          route="research"
          episodes={context.episodes.map((episode) => ({ slug: episode.slug, ordinal: episode.ordinal, title: episode.title }))}
          share={share}
        />
        <div data-surface className="folio-surface flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </div>
      </div>
      <div id="research-drawer" data-drawer-slot className="relative z-[7] flex min-h-0 flex-none" />
      <SourceDrawer
        projectId={context.project.id}
        sources={load.sources}
        collections={load.collections}
        clips={load.clips}
        targets={load.targets}
        baseHref={baseHref}
      />
    </FindProvider>
  )
}
