import type { ReactNode } from 'react'

import { loadShareLink } from '../../../../../../lib/share/server'
import { loadTimeline } from '../../../../../../lib/timeline/server'
import { countsOf, threadPresence } from '../../../../../../lib/timeline/view'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { PlacedWidget, ThreadGroup, TimelineFind, TimelineTitleRow } from '../_timeline/timeline-sidebar'
import { TimelineHeaderViews, TimelineStateProvider } from '../_timeline/view-state'
import { FindProvider } from './find-field'
import { Sidebar } from './sidebar'
import { WritingHeader } from './writing-header'

/**
 * The Timeline route's shell - the three parts every route wears
 * (`docs/ui design/README.md`, "Shell"), on `_chrome/locations-layout.tsx`'s
 * pattern: the sidebar card with this route's four slots
 * (`_timeline/timeline-sidebar.tsx`), the header told its route (the
 * crumb is `Project / Timeline` with no episode - the route is
 * project-scoped) and handed this route's view tabs for its centre
 * (`TimelineHeaderViews`: the views are state since 2026-09-18, not
 * `?view=`, so the header cannot read them from the URL), and the
 * main-surface card the page body sits in. The rebuild (2026-09-18)
 * retired the route's pre-redesign `ContextColumn` and its own header
 * and footer - the last route on the old chrome.
 *
 * ## The drawer's slot
 *
 * The scene drawer is a sibling of `<main>`, full height beside the
 * header, in flow above 1200px. The page renders inside the surface, so
 * the layout leaves an empty slot after the column and the page's drawer
 * portals into it (`_chrome/drawer-shell.tsx`). Unlike Characters' and
 * Locations' drawers this one is not a path - `/timeline/:sceneId` waits
 * on open decision 10 - so there is nothing for the layout to read from
 * the URL; the selection is the provider's.
 *
 * ## The empty route is quiet
 *
 * With no scene at all the sidebar draws neither the find field nor the
 * widget - the 440px empty card is the whole page.
 *
 * ## One read
 *
 * `loadTimeline` is `cache()`d on the project context; the page makes the
 * same call, so the two share one read per request. `loadEpisode` with no
 * segment is the shell's own "last opened, else first" - the shared
 * `Sidebar` takes an episode context, and this route hands it one it
 * never prints.
 */
export const TimelineLayout = async ({ projectId, children }: { readonly projectId: string; readonly children: ReactNode }) => {
  const context = await loadEpisode(projectId, null)
  const [share, load] = await Promise.all([loadShareLink(context.scope), loadTimeline(context)])
  // The widget counts placed scenes; the flag count is the body's, which runs the check.
  const counts = countsOf(load.scenes, load.threads.length, 0)
  const presence = Object.fromEntries(load.threads.map((thread) => [thread.id, threadPresence(thread, load.scenes, load.episodes)]))
  const quiet = load.scenes.length === 0

  return (
    <TimelineStateProvider>
      <FindProvider>
        <Sidebar
          context={context}
          slots={{
            title: <TimelineTitleRow title={context.project.title} />,
            find: quiet ? null : <TimelineFind />,
            group: <ThreadGroup projectId={context.project.id} threads={load.threads} presence={presence} />,
            widget: quiet ? null : <PlacedWidget counts={counts} />,
            label: 'Threads',
          }}
        />
        <div data-writing-column className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col">
          <WritingHeader
            projectId={context.project.id}
            projectTitle={context.project.title}
            shape={context.shape}
            route="timeline"
            episodes={context.episodes.map((episode) => ({ slug: episode.slug, ordinal: episode.ordinal, title: episode.title }))}
            share={share}
            views={<TimelineHeaderViews />}
          />
          <div data-surface className="folio-surface flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </div>
        </div>
        <div id="timeline-drawer" data-drawer-slot className="relative z-[7] flex min-h-0 flex-none" />
      </FindProvider>
    </TimelineStateProvider>
  )
}
