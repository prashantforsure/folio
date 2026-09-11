'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import { useEffect } from 'react'

import { lastOpenedEpisodeCookieValue } from '../../../../../../lib/workspace/last-episode'

/**
 * Writes the "last opened episode" cookie. Renders nothing.
 *
 * Mounted by `[episodeId]/layout.tsx`, so it runs only for a segment the
 * server has already validated and resolved. See `lib/workspace/last-episode.ts`
 * for why this is a cookie and why the browser writes it.
 */
export const RememberEpisode = ({
  projectId,
  slug,
}: {
  readonly projectId: ProjectId
  readonly slug: EpisodeSlug
}) => {
  useEffect(() => {
    try {
      document.cookie = lastOpenedEpisodeCookieValue(projectId, slug)
    } catch {
      // A blocked cookie jar leaves "first episode" as the fallback, which is
      // a correct answer rather than a broken one.
    }
  }, [projectId, slug])
  return null
}
