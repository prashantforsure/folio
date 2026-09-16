import type { ReactNode } from 'react'

import { loadLocations } from '../../../../../../lib/locations/server'
import { sidebarRowOf } from '../../../../../../lib/locations/view'
import { loadShareLink } from '../../../../../../lib/share/server'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { LocationFind, LocationGroups, LocationTitleRow, ScoutedWidget } from '../_locations/location-sidebar'
import { NewLocationDrawer } from '../_locations/new-location-drawer'
import { FindProvider } from './find-field'
import { Sidebar } from './sidebar'
import { WritingHeader } from './writing-header'

/**
 * The Locations route's shell - the three parts every route wears
 * (`docs/ui design/README.md`, "Shell"), on `_chrome/characters-layout.tsx`'s
 * pattern: the sidebar card with this route's four slots
 * (`_locations/location-sidebar.tsx`), the header told its route (the crumb
 * is `Project / Locations` with no episode - the route is project-scoped -
 * and `Places · Scenes here · Sheet` in its centre), and the main-surface
 * card the page body sits in.
 *
 * ## The drawer's slot
 *
 * `Route - Locations v2.dc.html` draws the edit drawer as a sibling of
 * `<main>`, full height beside the header, in flow above 1200px. The
 * drawer is the page's (`/locations/:id`), and a page renders inside the
 * surface - so the layout leaves an empty slot after the column and the
 * page's drawer portals into it (`_chrome/drawer-shell.tsx`). The `New
 * location` drawer is nobody's page and mounts here, in the same slot,
 * opened through `lib/locations/compose.ts`.
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

  return (
    <FindProvider>
      <Sidebar
        context={context}
        slots={{
          title: <LocationTitleRow title={context.project.title} />,
          find: rows.length === 0 ? null : <LocationFind />,
          group: <LocationGroups projectId={context.project.id} rows={rows} />,
          widget: <ScoutedWidget rows={rows} />,
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
        />
        <div data-surface className="folio-surface flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </div>
      </div>
      <div id="locations-drawer" data-drawer-slot className="relative z-[7] flex min-h-0 flex-none" />
      <NewLocationDrawer projectId={context.project.id} parents={parents} />
    </FindProvider>
  )
}
