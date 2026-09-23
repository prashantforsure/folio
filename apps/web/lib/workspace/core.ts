import { TitleSchema } from '@folio/contracts'
import { appendEpisode, listEpisodes, renameEpisode as rename } from '@folio/db'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import type { EpisodeGate, GateRefusal, ProjectGate } from '../script/actor-gate'
import { REFUSED, roleRefusal } from '../script/actor-gate'
import { defaultEpisodeTitle } from './format'
import { episodeRouteHref } from './hrefs'
import type { EpisodeActionResult } from './result'

/**
 * Creating and renaming an episode as **core functions** - roadmap task 4.2.
 * The actions in `actions.ts` (whose header is the account of both, and of the
 * delete, which stays there: D16 gives the agent no delete) open the cookie
 * gate and revalidate; the agent's episode tools and the worker call these
 * with a gate of their own.
 */

const NOT_FOUND = 'That project could not be found.'

/**
 * A gate refusal as this route's result. Only the gate's own not-found wording
 * is replaced - and only to say "project" where the shared gate says "script",
 * because this popover is about neither.
 */
export const refusalOf = (gate: GateRefusal): EpisodeActionResult => ({
  status: 'error',
  message: gate.message === REFUSED.message ? NOT_FOUND : gate.message,
})

const parseTitle = (raw: unknown): string | null => {
  const parsed = TitleSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

export const episodeKeyProblem = (rawKey: unknown): EpisodeActionResult | null =>
  idempotencyKeyOf(rawKey).ok ? null : { status: 'error', message: BAD_IDEMPOTENCY_KEY }

export const createEpisodeWith = async (gate: ProjectGate, title: string | null, rawKey: unknown = null): Promise<EpisodeActionResult> => {
  const refused = roleRefusal(gate, ROLE.episodeCreate)
  if (refused !== null) return refusalOf(refused)
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  if (gate.project.projectType === 'film') {
    return { status: 'error', message: 'A film is one document. It has one episode and cannot take another.' }
  }

  // An empty name is the default, not a refusal: the placeholder said so.
  const existing = await listEpisodes(gate.scope)
  const next = (existing.at(-1)?.ordinal ?? 0) + 1
  const named = title === null || title.trim().length === 0 ? defaultEpisodeTitle(next) : parseTitle(title)
  if (named === null) return { status: 'error', message: 'A name is up to 200 characters.' }

  const episode = await appendEpisode(gate.scope, named, key.key)
  return {
    status: 'done',
    episode: { slug: episode.slug, ordinal: episode.ordinal, title: episode.title },
    href: episodeRouteHref({ projectId: gate.project.id, shape: 'episodic', episode: episode.slug }, 'script'),
  }
}

export const episodeTitleProblem = (title: unknown): EpisodeActionResult | null =>
  parseTitle(title) === null ? { status: 'error', message: 'Give the episode a name - up to 200 characters.' } : null

export const renameEpisodeWith = async (gate: EpisodeGate, title: unknown): Promise<EpisodeActionResult> => {
  const refused = roleRefusal(gate, ROLE.episodeCreate)
  if (refused !== null) return refusalOf(refused)
  const named = parseTitle(title)
  if (named === null) return { status: 'error', message: 'Give the episode a name - up to 200 characters.' }

  if (named !== gate.episode.title) await rename(gate.scope, gate.episode.id, named)
  const shape = gate.project.projectType === 'film' ? 'collapsed' : 'episodic'
  return {
    status: 'done',
    episode: { slug: gate.episode.slug, ordinal: gate.episode.ordinal, title: named },
    href: episodeRouteHref({ projectId: gate.project.id, shape, episode: gate.episode.slug }, 'script'),
  }
}
