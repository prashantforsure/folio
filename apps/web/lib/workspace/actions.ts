'use server'

import { TitleSchema } from '@folio/contracts'
import { appendEpisode, deleteEpisode as remove, listEpisodes, renameEpisode as rename } from '@folio/db'
import { revalidatePath } from 'next/cache'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import { REFUSED, isRefusal, openEpisode, openProject } from '../script/gate'
import type { GateRefusal } from '../script/gate'
import { defaultEpisodeTitle } from './format'
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
 * None of the actions redirects. They return the episode and a script URL
 * and the popover navigates, so a refusal can be shown in place instead of
 * surfacing as a thrown redirect the client cannot tell from a failure. For
 * a delete the URL is the neighbour's - the episode before, else the one
 * after - since the current one is gone.
 */

const NOT_FOUND = 'That project could not be found.'

/**
 * A gate refusal as this route's result.
 *
 * Every refusal used to become `NOT_FOUND`, which was already wrong for "Sign
 * in to keep writing" and became worse with roles: a member told their episode
 * does not exist, when what happened is that their role does not reach
 * `ROLE.episodeDelete`, will look for the episode. Only the gate's own
 * not-found wording is replaced - and only to say "project" where the shared
 * gate says "script", because this popover is about neither.
 */
const refusalOf = (gate: GateRefusal): EpisodeActionResult => ({
  status: 'error',
  message: gate.message === REFUSED.message ? NOT_FOUND : gate.message,
})

const parseTitle = (raw: unknown): string | null => {
  const parsed = TitleSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

export const createEpisode = async (
  projectId: string,
  title: string | null,
  rawKey: unknown = null,
): Promise<EpisodeActionResult> => {
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  const gate = await openProject(projectId, ROLE.episodeCreate)
  if (isRefusal(gate)) return refusalOf(gate)
  if (gate.project.projectType === 'film') {
    return { status: 'error', message: 'A film is one document. It has one episode and cannot take another.' }
  }

  // An empty name is the default, not a refusal: the placeholder said so.
  const existing = await listEpisodes(gate.scope)
  const next = (existing.at(-1)?.ordinal ?? 0) + 1
  const named = title === null || title.trim().length === 0 ? defaultEpisodeTitle(next) : parseTitle(title)
  if (named === null) return { status: 'error', message: 'A name is up to 200 characters.' }

  const episode = await appendEpisode(gate.scope, named, key.key)
  revalidatePath(`/app/project/${gate.project.id}`, 'layout')
  return {
    status: 'done',
    episode: { slug: episode.slug, ordinal: episode.ordinal, title: episode.title },
    href: episodeRouteHref({ projectId: gate.project.id, shape: 'episodic', episode: episode.slug }, 'script'),
  }
}

export const renameEpisode = async (projectId: string, episodeSlug: string, title: string): Promise<EpisodeActionResult> => {
  const named = parseTitle(title)
  if (named === null) return { status: 'error', message: 'Give the episode a name - up to 200 characters.' }

  const gate = await openEpisode(projectId, episodeSlug, ROLE.episodeCreate)
  if (isRefusal(gate)) return refusalOf(gate)

  if (named !== gate.episode.title) await rename(gate.scope, gate.episode.id, named)
  revalidatePath(`/app/project/${gate.project.id}`, 'layout')
  const shape = gate.project.projectType === 'film' ? 'collapsed' : 'episodic'
  return {
    status: 'done',
    episode: { slug: gate.episode.slug, ordinal: gate.episode.ordinal, title: named },
    href: episodeRouteHref({ projectId: gate.project.id, shape, episode: gate.episode.slug }, 'script'),
  }
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
