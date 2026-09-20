import type { ReactNode } from 'react'

import { loadShareLink } from '../../../../../../lib/share/server'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { CharactersHeaderViews, CharactersViewProvider } from '../_characters/view-state'
import { WritingHeader } from './writing-header'

/**
 * The Characters route's shell - the fourth pass (2026-09-20, laper.ai's
 * route shape by the client's ruling): **no sidebar** (ruling 2). The
 * column is full width like the Storyboard canvas: the header told its
 * route (the crumb is `Project / Characters` with no episode - the route
 * is project-scoped) and handed this route's view tabs for its centre
 * (`CharactersHeaderViews`: `Canvas · Relationships · List` are state, not
 * `?view=`, so the header cannot read them from the URL as it does the
 * other routes'), then the main-surface card the page body sits in. The
 * count, the `Needs a decision` pill and `+ New character` sit in the
 * body's toolbar row (`_characters/characters-toolbar.tsx`), where the
 * sidebar's groups and widget used to carry them.
 *
 * ## The drawer's slot
 *
 * The drawer is a sibling of `<main>`, full height beside the header, in
 * flow above 1200px. The page's drawers (`/characters/:id`, `New
 * character`, the `Needs a decision` panel) render inside the surface and
 * portal into the empty slot after the column; exactly one is in it at a
 * time (`_characters/characters-workspace.tsx`).
 *
 * ## The intercepted `/characters/:id`, beside all of it
 *
 * `modal` is the `@modal` parallel slot (`characters/layout.tsx`): null on
 * every URL but the intercepted one, which draws the edit drawer as its
 * own floating sheet over a blurred scrim (`overlay`,
 * `_chrome/drawer-shell.tsx`) portalled straight to `body` - not into the
 * slot above, and not into `#characters-drawer` either. It is rendered as
 * a sibling here only so it is part of this layout's tree; it paints
 * nowhere near this markup.
 *
 * ## One read, in the page
 *
 * The layout no longer reads the cast: nothing here prints a count. The
 * page's `loadCharacters` is the one read per request. `loadEpisode` with
 * no segment is the shell's own "last opened, else first" - the header
 * takes an episode list it never lights on this route.
 */
export const CharactersLayout = async ({
  projectId,
  children,
  modal,
}: {
  readonly projectId: string
  readonly children: ReactNode
  readonly modal: ReactNode
}) => {
  const context = await loadEpisode(projectId, null)
  const share = await loadShareLink(context.scope)

  return (
    <CharactersViewProvider>
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
      {modal}
    </CharactersViewProvider>
  )
}
