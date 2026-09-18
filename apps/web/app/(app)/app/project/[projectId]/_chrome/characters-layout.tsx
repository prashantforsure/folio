import type { ReactNode } from 'react'

import { figuresOf } from '../../../../../../lib/characters/cast'
import { loadCharacters } from '../../../../../../lib/characters/server'
import { loadShareLink } from '../../../../../../lib/share/server'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { CastFind, CastFootWidget, CastGroups, CastTitleRow } from '../_characters/cast-sidebar'
import { CharactersHeaderViews, CharactersViewProvider } from '../_characters/view-state'
import { FindProvider } from './find-field'
import { Sidebar } from './sidebar'
import { WritingHeader } from './writing-header'

/**
 * The Characters route's shell - the three parts every route wears
 * (`docs/ui design/README.md`, "Shell"), on `_chrome/production-layout.tsx`'s
 * pattern: the sidebar card with this route's four slots
 * (`_characters/cast-sidebar.tsx`, on the record routes' shared pieces),
 * the header told its route (the crumb is `Project / Characters` with no
 * episode - the route is project-scoped) and handed this route's view tabs
 * for its centre (`CharactersHeaderViews`: the views are state, not
 * `?view=`, so the header cannot read them from the URL as it does the
 * other routes'), and the main-surface card the page body sits in.
 *
 * ## The drawer's slot
 *
 * The edit drawer is a sibling of `<main>`, full height beside the header,
 * in flow above 1200px. The drawer is the page's (`/characters/:id`), and a
 * page renders inside the surface - so the layout leaves an empty slot
 * after the column and the page's drawer portals into it. The `New
 * character` drawer mounts from the workspace too since 2026-09-17, so the
 * two can never be in the slot at once.
 *
 * ## The empty route is quiet
 *
 * With no record and nothing in the queue the sidebar draws neither the
 * find field nor the widget - the 440px empty card is the whole page.
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
    role: figure.role,
    appearances: figure.appearances,
    group: figure.group,
    status: figure.status,
    presence: figure.presence,
  }))
  // The queue's cue rows and its pair rows both need a decision; the sidebar counts both.
  const decisions = [
    ...load.resolve.map((item) => ({ key: item.key, cue: item.cue, occurrences: item.occurrences })),
    ...load.pairs.map((pair) => ({ key: pair.key, cue: `${pair.other.name} · ${pair.keep.name}`, occurrences: pair.other.appearances })),
  ]
  const walkOns = load.walkOns.map((item) => ({ key: item.key, cue: item.cue, occurrences: item.occurrences }))
  const quiet = rows.length === 0 && decisions.length === 0

  return (
    <CharactersViewProvider>
      <FindProvider>
        <Sidebar
          context={context}
          slots={{
            title: <CastTitleRow title={context.project.title} />,
            find: quiet ? null : <CastFind />,
            group: <CastGroups projectId={context.project.id} rows={rows} decisions={decisions} walkOns={walkOns} />,
            widget: quiet ? null : <CastFootWidget projectId={context.project.id} rows={rows} decisions={decisions.length} />,
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
            views={<CharactersHeaderViews />}
          />
          <div data-surface className="folio-surface flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </div>
        </div>
        <div id="characters-drawer" data-drawer-slot className="relative z-[7] flex min-h-0 flex-none" />
      </FindProvider>
    </CharactersViewProvider>
  )
}
