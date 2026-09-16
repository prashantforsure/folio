import type { ReactNode } from 'react'

import { loadShareLink } from '../../../../../../lib/share/server'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { Sidebar } from './sidebar'
import { WritingHeader } from './writing-header'

/**
 * The writing surface's shell: sidebar, header, and the main-surface card
 * the route body sits in. Both `(writing)` layouts - the episodic one under
 * `[episodeId]/` and the collapsed one under `(film)/` - render this with
 * the segment they have.
 *
 * `docs/ui design/README.md`, "Main surface": "One `--s1` card with
 * `border-radius: 18px 0 0 0` and a backdrop blur, holding the toolbar, the
 * scrolling content, and the status bar." The route body is that card's
 * content; the writing routes have no status bar (none of their mockups
 * draws one).
 *
 * A layout cannot see which child it renders, so the header - a Client
 * Component - reads the route from `useSelectedLayoutSegment` for its
 * centre (the route's views) and the breadcrumb's links. Everything else
 * it draws (the episodes, the share link) is read here and passed as data.
 */
export const WritingLayout = async ({
  projectId,
  episodeId,
  children,
}: {
  readonly projectId: string
  readonly episodeId: string | null
  readonly children: ReactNode
}) => {
  const context = await loadEpisode(projectId, episodeId)
  const share = await loadShareLink(context.scope)
  return (
    <>
      <Sidebar context={context} />
      <div data-writing-column className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col">
        <WritingHeader
          projectId={context.project.id}
          projectTitle={context.project.title}
          shape={context.shape}
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
