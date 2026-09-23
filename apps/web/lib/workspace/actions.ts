'use server'

import { deleteEpisode as remove, listEpisodes } from '@folio/db'
import { revalidatePath } from 'next/cache'

import { ROLE } from '../auth/roles'
import { isRefusal, openEpisode, openProject } from '../script/gate'
import { createEpisodeWith, episodeKeyProblem, episodeTitleProblem, refusalOf, renameEpisodeWith } from './core'
import { episodeRouteHref } from './hrefs'
import type { EpisodeActionResult } from './result'

/**
 * The three mutations the workspace chrome makes: `+` / `New episode…`,
 * `Rename episode…` (the episode form, in the header menu and under the
 * sidebar's title row) and `Delete episode…` (the header menu's confirm).
 *
 * Same gate as every other action (`lib/script/gate.ts`): identity, then
 * membership, then the role. The split here is ADR 0003 **D2**'s own line -
 * creating and renaming an episode is a writer's (`ROLE.episodeCreate`),
 * deleting one is the owner's (`ROLE.episodeDelete`), because an episode is a
 * container of work and taking it away is a different kind of act from
 * filling it.
 *
 * **A film refuses to add.** AGENTS.md, Routing: a film has exactly one
 * episode row, and the router hides the segment. A second row would give the
 * collapsed URL two candidates and no rule. The refusal is the server's; the
 * button is simply not rendered for a film, which is the client disclosing
 * what the server enforces. A film's one episode can still be renamed -
 * that name is the toolbar's title.
 *
 * The slug is minted by the repository from the next ordinal and checked by
 * `assertCreatableEpisodeSlug` before the insert - the same validator the
 * router runs on a URL - so nothing here could create an episode called
 * `characters` even if it tried.
 *
 * **Delete is a hard delete**, ruled 2026-09-16 after the AGENTS.md "delete
 * or purge user data" question was put: the row goes and everything keyed
 * to it goes with it (`deleteEpisode` in `@folio/db` lists what). The last
 * episode refuses - a project always has one (`loadProject` throws on
 * none), and a film's only episode is the film. The confirm in the menu
 * says all of this before the call.
 *
 * Creating and renaming are thin actions over core functions (`core.ts`,
 * roadmap task 4.2) that the agent's episode tools and the worker call with a
 * gate of their own; deleting has no core, because D16 gives the agent no
 * delete.
 *
 * None of the actions redirects. They return the episode and a script URL
 * and the popover navigates, so a refusal can be shown in place instead of
 * surfacing as a thrown redirect the client cannot tell from a failure. For
 * a delete the URL is the neighbour's - the episode before, else the one
 * after - since the current one is gone.
 */

export const createEpisode = async (
  projectId: string,
  title: string | null,
  rawKey: unknown = null,
): Promise<EpisodeActionResult> => {
  const problem = episodeKeyProblem(rawKey)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.episodeCreate)
  if (isRefusal(gate)) return refusalOf(gate)
  const result = await createEpisodeWith(gate, title, rawKey)
  if (result.status === 'done') revalidatePath(`/app/project/${gate.project.id}`, 'layout')
  return result
}

export const renameEpisode = async (projectId: string, episodeSlug: string, title: string): Promise<EpisodeActionResult> => {
  const problem = episodeTitleProblem(title)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episodeSlug, ROLE.episodeCreate)
  if (isRefusal(gate)) return refusalOf(gate)
  const result = await renameEpisodeWith(gate, title)
  if (result.status === 'done') revalidatePath(`/app/project/${gate.project.id}`, 'layout')
  return result
}

export const deleteEpisode = async (projectId: string, episodeSlug: string): Promise<EpisodeActionResult> => {
  const gate = await openEpisode(projectId, episodeSlug, ROLE.episodeDelete)
  if (isRefusal(gate)) return refusalOf(gate)
  if (gate.project.projectType === 'film') {
    return { status: 'error', message: 'A film is one document. Its episode is the film; trash the project instead.' }
  }

  const all = await listEpisodes(gate.scope)
  const at = all.findIndex((episode) => episode.id === gate.episode.id)
  const neighbour = all[at - 1] ?? all[at + 1]
  if (neighbour === undefined) {
    return { status: 'error', message: 'A series keeps at least one episode. Add another before deleting this one.' }
  }

  await remove(gate.scope, gate.episode.id)
  revalidatePath(`/app/project/${gate.project.id}`, 'layout')
  return {
    status: 'done',
    episode: { slug: neighbour.slug, ordinal: neighbour.ordinal, title: neighbour.title },
    href: episodeRouteHref({ projectId: gate.project.id, shape: 'episodic', episode: neighbour.slug }, 'script'),
  }
}
