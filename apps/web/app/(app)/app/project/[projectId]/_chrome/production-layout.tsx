import type { ReactNode } from 'react'

import { loadShareLink } from '../../../../../../lib/share/server'
import { SettingsChip } from '../_production/settings-chip'
import { loadEpisode } from '../../../../../../lib/workspace/context'
import { WritingHeader } from './writing-header'

/**
 * Production's shell, in both URL shapes: the header and the surface the
 * route body sits in. No sidebar - the v12 mockup draws rail, header and
 * panel only (`docs/production/production.md`, §2). The header's centre is
 * empty (Cards | Columns is a saved preference, not a tab); its actions
 * slot draws the settings chip (§2.2).
 *
 * `/production` is **episode-scoped** - AGENTS.md open decision 5, ruled by
 * the client.
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
  const share = await loadShareLink(context.scope)
  return (
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
        views={null}
        actions={<SettingsChip />}
      />
      <div data-surface className="folio-surface flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}
