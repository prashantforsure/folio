import type { ReactNode } from 'react'

import { loadLocations } from '../../../../../../lib/locations/server'
import { sidebarRowOf } from '../../../../../../lib/locations/view'
import { loadShareLink } from '../../../../../../lib/share/server'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { LocationFind, LocationFootWidget, LocationGroups, LocationTitleRow } from '../_locations/location-sidebar'
import { NewLocationDrawer } from '../_locations/new-location-drawer'
import { LocationsHeaderViews, LocationsViewProvider } from '../_locations/view-state'
import { FindProvider } from './find-field'
import { Sidebar } from './sidebar'
import { WritingHeader } from './writing-header'

/**
 * The Locations route's shell - the three parts every route wears
 * (`docs/ui design/README.md`, "Shell"), on `_chrome/characters-layout.tsx`'s
 * pattern: the sidebar card with this route's four slots
 * (`_locations/location-sidebar.tsx`), the header told its route (the crumb
 * is `Project / Locations` with no episode - the route is project-scoped)
 * and handed this route's view tabs for its centre (`LocationsHeaderViews`:
 * the views are state since 2026-09-18, not `?view=`, so the header cannot
 * read them from the URL as it does the other routes'), and the
 * main-surface card the page body sits in.
 *
 * ## The drawer's slot
 *
 * The edit drawer is a sibling of `<main>`, full height beside the header,
 * in flow above 1200px. The drawer is the page's (`/locations/:id`), and a
 * page renders inside the surface - so the layout leaves an empty slot
 * after the column and the page's drawer portals into it
 * (`_chrome/drawer-shell.tsx`). The `New location` drawer is nobody's page
 * and mounts here, in the same slot, opened through `lib/locations/compose.ts`.
 *
 * ## The empty route is quiet
 *
 * With no record and nothing in the queue the sidebar draws neither the
 * find field nor the widget - the 440px empty card is the whole page.
 *
 * ## One read
 *
 * `loadLocations` is `cache()`d on the project context; the page makes the
 * same call, so the two share one read per request. `loadEpisode` with no
 * segment is the shell's own "last opened, else first" - the shared
 * `Sidebar` takes an episode context, and this route hands it one it never
 * prints.
 */
export const LocationsLayout = async ({ projectId, children }: { readonly projectId: string; readonly children: ReactNode }) => {
  const context = await loadEpisode(projectId, null)
  const [share, load] = await Promise.all([loadShareLink(context.scope), loadLocations(context)])
  const rows = load.rows.map(sidebarRowOf)
  const parents = load.rows.filter((row) => row.parentId === null).map((row) => ({ id: row.id, name: row.name }))
  const decisions = load.resolve.map((item) => ({ key: item.key, slugline: item.slugline, occurrences: item.occurrences }))
  const quiet = rows.length === 0 && decisions.length === 0

  return (
    <LocationsViewProvider>
      <FindProvider>
        <Sidebar
          context={context}
          slots={{
            title: <LocationTitleRow title={context.project.title} />,
            find: quiet ? null : <LocationFind />,
            group: <LocationGroups projectId={context.project.id} rows={rows} decisions={decisions} />,
            widget: quiet ? null : <LocationFootWidget projectId={context.project.id} rows={rows} decisions={decisions.length} />,
            label: 'Locations',
          }}
        />
        <div data-writing-column className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col">
          <WritingHeader
            projectId={context.project.id}
            projectTitle={context.project.title}
            shape={context.shape}
            route="locations"
            episodes={context.episodes.map((episode) => ({ slug: episode.slug, ordinal: episode.ordinal, title: episode.title }))}
            share={share}
            views={<LocationsHeaderViews />}
          />
          <div data-surface className="folio-surface flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </div>
        </div>
        <div id="locations-drawer" data-drawer-slot className="relative z-[7] flex min-h-0 flex-none" />
        <NewLocationDrawer projectId={context.project.id} parents={parents} />
      </FindProvider>
    </LocationsViewProvider>
  )
}
