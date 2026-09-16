import type { ReactNode } from 'react'

import { figuresOf } from '../../../../../../lib/characters/cast'
import { loadCharacters } from '../../../../../../lib/characters/server'
import { loadShareLink } from '../../../../../../lib/share/server'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { CastFind, CastGroups, CastSidebarProvider, CastTitleRow, DefinedWidget } from '../_characters/cast-sidebar'
import { NewCharacterDrawer } from '../_characters/new-character-drawer'
import { Sidebar } from './sidebar'
import { WritingHeader } from './writing-header'

/**
 * The Characters route's shell - the three parts every route wears
 * (`docs/ui design/README.md`, "Shell"), on `_chrome/production-layout.tsx`'s
 * pattern: the sidebar card with this route's four slots
 * (`_characters/cast-sidebar.tsx`), the header told its route (no Write /
 * Storyboard pill: Characters is "outside the writing surface"; the crumb
 * is `Project / Characters` with no episode - the route is project-scoped),
 * and the main-surface card the page body sits in.
 *
 * ## The drawer's slot
 *
 * `Route - Characters v2.dc.html` draws the edit drawer as a sibling of
 * `<main>`, full height beside the header, in flow above 1200px. The
 * drawer is the page's (`/characters/:id`), and a page renders inside the
 * surface - so the layout leaves an empty slot after the column and the
 * page's drawer portals into it (`_characters/character-drawer.tsx`). The
 * `New character` drawer is nobody's page and mounts here, in the same
 * slot, opened through `lib/characters/compose.ts`.
 *
 * ## One read
 *
 * `loadCharacters` is `cache()`d on the project context; the page makes
 * the same call, so the two share one read per request. `loadEpisode` with
 * no segment is the shell's own "last opened, else first" - the shared
 * `Sidebar` takes an episode context, and this route hands it one it never
 * prints.
 */
export const CharactersLayout = async ({ projectId, children }: { readonly projectId: string; readonly children: ReactNode }) => {
  const context = await loadEpisode(projectId, null)
  const [share, load] = await Promise.all([loadShareLink(context.scope), loadCharacters(context)])
  const figures = figuresOf(
    load.cast,
    load.index,
    context.episodes.map((episode) => episode.ordinal),
    load.resolve,
  )
  const rows = figures.map((figure) => ({
    id: figure.id,
    name: figure.name,
    short: figure.short,
    initial: figure.initial,
    hue: figure.hue,
    role: figure.role,
    appearances: figure.appearances,
    group: figure.group,
    status: figure.status,
  }))

  return (
    <CastSidebarProvider>
      <Sidebar
        context={context}
        slots={{
          title: <CastTitleRow title={context.project.title} />,
          find: rows.length === 0 ? null : <CastFind />,
          group: <CastGroups projectId={context.project.id} rows={rows} />,
          widget: <DefinedWidget rows={rows} />,
          label: 'Cast',
        }}
      />
      <div data-writing-column className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col">
        <WritingHeader
          projectId={context.project.id}
          projectTitle={context.project.title}
          shape={context.shape}
          route="characters"
          episodes={context.episodes.map((episode) => ({ slug: episode.slug, ordinal: episode.ordinal, title: episode.title }))}
          share={share}
        />
        <div data-surface className="folio-surface flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </div>
      </div>
      <div id="characters-drawer" data-drawer-slot className="relative z-[7] flex min-h-0 flex-none" />
      <NewCharacterDrawer projectId={context.project.id} usedHues={rows.map((row) => row.hue)} />
    </CastSidebarProvider>
  )
}
