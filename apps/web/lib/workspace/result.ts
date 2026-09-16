import type { EpisodeSlug } from '@folio/contracts'

import type { EpisodeRoutePath } from './hrefs'

/**
 * What `createEpisode`, `renameEpisode` and `deleteEpisode` hand back. Same
 * shape and reason as `lib/projects/result.ts`: a discriminated result,
 * never a throw across the boundary. Kept out of `actions.ts` because a
 * `'use server'` module may export only async functions.
 *
 * `done` carries an episode as the chrome draws it and a script URL: the
 * new episode's for a creation, the same one's for a rename, and the
 * neighbour's for a delete (the deleted one no longer has a URL). The
 * action does not `redirect()` itself: it is called from a popover that
 * wants to show the refusal in place, and a thrown redirect cannot be told
 * apart from a failure there.
 */
export type EpisodeActionResult =
  | {
      readonly status: 'done'
      readonly episode: { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }
      readonly href: EpisodeRoutePath
    }
  | { readonly status: 'error'; readonly message: string }
