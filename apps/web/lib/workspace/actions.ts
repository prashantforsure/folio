'use server'

import { ProjectIdSchema } from '@folio/contracts'
import {
  appendEpisode,
  listEpisodes,
  openProjectForRequest,
  readMembershipFor,
  readProject,
  transactionDatabase,
} from '@folio/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireUser } from '../auth/session'
import { episodeRouteHref } from './hrefs'
import type { CreateEpisodeResult } from './result'

/**
 * The one mutation the workspace chrome makes: the `＋ New episode` button.
 *
 * Same gate order as `lib/projects/actions.ts`: identity, then membership,
 * then a scope. Membership, not role - `memberships.role` is read by nothing
 * yet (`docs/build-decisions.md`), and deciding here that only an owner may
 * add an episode would be the first line of a capability model nobody has
 * specified.
 *
 * **A film refuses.** AGENTS.md, Routing: a film has exactly one episode row,
 * and the router hides the segment. A second row would give the collapsed
 * URL two candidates and no rule. The refusal is the server's; the button is
 * simply not rendered for a film, which is the client disclosing what the
 * server enforces.
 *
 * The slug is minted by the repository from the next ordinal and checked by
 * `assertCreatableEpisodeSlug` before the insert - the same validator the
 * router runs on a URL - so nothing here could create an episode called
 * `characters` even if it tried. The title is `Episode N` until renamed;
 * renaming is project settings, which is a stub.
 */

export const createEpisode = async (
  _previous: CreateEpisodeResult,
  formData: FormData,
): Promise<CreateEpisodeResult> => {
  const raw = formData.get('projectId')
  const parsed = ProjectIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  if (!parsed.success) return { status: 'error', message: 'That project could not be found.' }
  const projectId = parsed.data

  const user = await requireUser(`/app/project/${projectId}`)
  const db = await transactionDatabase()
  const membership = await readMembershipFor(db, user.id, projectId)
  if (membership === null) return { status: 'error', message: 'That project could not be found.' }

  const scope = await openProjectForRequest(projectId, user.id)
  const project = await readProject(scope)
  if (project === null) return { status: 'error', message: 'That project could not be found.' }
  if (project.projectType === 'film') {
    return { status: 'error', message: 'A film is one document. It has one episode and cannot take another.' }
  }

  // The title's number is the ordinal the repository is about to assign.
  const existing = await listEpisodes(scope)
  const episode = await appendEpisode(scope, `Episode ${String((existing.at(-1)?.ordinal ?? 0) + 1)}`)

  revalidatePath(`/app/project/${projectId}`, 'layout')
  redirect(episodeRouteHref({ projectId, shape: 'episodic', episode: episode.slug }, 'script'))
}

