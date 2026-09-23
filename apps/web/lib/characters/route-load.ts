import type { CharacterProfile } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { notFound, redirect } from 'next/navigation'

import type { ProjectContext } from '../workspace/context'
import { loadProject } from '../workspace/context'
import { characterHref } from '../workspace/hrefs'
import { loadCharacters, loadProfile } from './server'
import type { CharactersLoad } from './server'

/**
 * The Characters route's loads that answer with a redirect or a 404 - the
 * two that need Next's request APIs. Moved out of `server.ts` (roadmap task
 * 4.2) so that file's reads - which the agent's tools and the worker call -
 * reach neither `next/navigation` nor the cookie-reading workspace context.
 */

/**
 * `loadProfile` plus the two doors every caller of it takes the same way:
 * a record merged into another redirects to the survivor, and an id that
 * names nothing here is a 404. Shared by the full `/characters/:id` page
 * (`characters-route.tsx`) and the intercepted one that opens the edit
 * modal over the canvas (`characters/@modal/(.)[characterId]/page.tsx`) -
 * one branch, written once.
 */
export const loadCharacterProfile = async (context: ProjectContext, characterId: CharacterId): Promise<CharacterProfile> => {
  const result = await loadProfile(context, characterId)
  if (result.state === 'merged') redirect(characterHref(context.project.id, result.into))
  if (result.state === 'missing') notFound()
  return result.profile
}

/** The route's context and its load, for a page or a layout that has only raw params. */
export const enterCharacters = async (rawProjectId: string): Promise<{ readonly context: ProjectContext; readonly load: CharactersLoad }> => {
  const context = await loadProject(rawProjectId)
  return { context, load: await loadCharacters(context) }
}
