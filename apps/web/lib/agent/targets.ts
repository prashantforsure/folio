import type { AgentRoute, NavigateTarget } from '@folio/contracts'
import { AGENT_EPISODE_ROUTES, AGENT_PROJECT_ROUTES } from '@folio/contracts'
import { listEpisodes, listSceneIndex } from '@folio/db'
import type { NodeId } from '@folio/script'
import { z } from 'zod'

import type { ToolGate } from './registry'

/**
 * A place in the app, resolved from what a tool or a card knows - a route, an
 * episode number, a scene, a record - into the `NavigateTarget` the panel
 * turns into a URL with `hrefs.ts` alone (roadmap task 2.5). The `navigate`
 * tool and a proposal card's Open button go through this one function, so the
 * two can never disagree about where a scene is.
 *
 * The shape and the episode are decided here by `enterEpisodeRoute`'s rules -
 * a film has no episode segment, a series always does, and a scene decides its
 * own episode - so the panel builds the URL without deciding anything.
 */

export type PlaceInput = {
  readonly route: AgentRoute
  readonly episode?: number | undefined
  readonly sceneId?: NodeId | undefined
  readonly recordId?: string | undefined
}

/** The routes with a page per record, and what the record is. */
const RECORD_ENTITY: Partial<Record<AgentRoute, 'character' | 'location' | 'prop' | 'research'>> = {
  characters: 'character',
  locations: 'location',
  props: 'prop',
  research: 'research',
}

/** The two reads a resolution needs, when the caller already holds them - the run history resolves many links from one read of each (roadmap task 5.4). */
export type KnownPlaces = {
  readonly episodes: Awaited<ReturnType<typeof listEpisodes>>
  readonly index: Awaited<ReturnType<typeof listSceneIndex>>
}

export const resolveTarget = async (
  gate: ToolGate,
  input: PlaceInput,
  known?: KnownPlaces,
): Promise<{ readonly ok: true; readonly target: NavigateTarget } | { readonly ok: false; readonly message: string }> => {
  const { project } = gate
  if ((AGENT_EPISODE_ROUTES as readonly string[]).includes(input.route)) {
    const route = z.enum(AGENT_EPISODE_ROUTES).parse(input.route)
    const [episodes, index] =
      known !== undefined
        ? [known.episodes, known.index]
        : await Promise.all([listEpisodes(gate.scope), input.sceneId === undefined ? Promise.resolve([]) : listSceneIndex(gate.scope)])
    const scene = input.sceneId === undefined ? undefined : index.find((row) => row.sceneNodeId === input.sceneId)
    if (input.sceneId !== undefined && scene === undefined) return { ok: false, message: 'There is no such scene in this project.' }
    const ordinal = scene?.episodeOrdinal ?? input.episode ?? gate.episode.ordinal
    const episode = episodes.find((entry) => entry.ordinal === ordinal)
    if (episode === undefined) return { ok: false, message: `There is no episode ${String(ordinal)}.` }
    return {
      ok: true,
      target: {
        kind: 'episode',
        projectId: project.id,
        shape: project.projectType === 'film' ? 'collapsed' : 'episodic',
        episode: episode.slug,
        route,
        ...(route === 'script' && scene !== undefined ? { sceneNodeId: scene.sceneNodeId } : {}),
      },
    }
  }
  if (input.recordId !== undefined) {
    const entity = RECORD_ENTITY[input.route]
    if (entity === undefined) return { ok: false, message: 'Only characters, locations, props and research have record pages.' }
    return { ok: true, target: { kind: 'record', projectId: project.id, entity, id: input.recordId } }
  }
  return { ok: true, target: { kind: 'route', projectId: project.id, route: z.enum(AGENT_PROJECT_ROUTES).parse(input.route) } }
}
