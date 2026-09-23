import { listSceneIndex } from '@folio/db'
import { z } from 'zod'

import { formatSceneRef, sceneRefOf } from '../../characters/figures'
import { ROLE } from '../../auth/roles'
import { defineTool } from '../registry'
import type { Tool } from '../registry'

/**
 * The core toolset - `docs/agents/tools.md`, *Core - always loaded*.
 *
 * Every turn offers these, whatever the route. Each is a **read**: it runs
 * immediately and writes nothing (AGENTS.md ruling **R8**, read-only until
 * Phase 3). Counts in a result are computed here, so the model has a number to
 * quote rather than one to work out (ruling **R4**).
 */

const plural = (count: number, one: string, many = `${one}s`): string => `${String(count)} ${count === 1 ? one : many}`

/**
 * `list_scenes` - every present scene, in running order: its citation
 * (`E2 Sc 9`), heading and size. From the derived scene index, so it is what
 * the Scenes route and the Characters route already read.
 */
export const listScenes = defineTool({
  name: 'list_scenes',
  description:
    'List the scenes of the script in running order: each scene\'s citation ("E1 Sc 3"), its heading, its episode, and how many lines and dialogue words it has. ' +
    'Pass an episode number to list only that episode. Use this before answering any question about which scenes exist, how many there are, or where something happens.',
  toolset: 'core',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({
    episode: z.number().int().min(1).optional().describe('An episode number (its ordinal, 1 for the first). Omit for every episode.'),
  }),
  label: (input) => (input.episode === undefined ? 'Reading the scene list' : `Reading the scenes of episode ${String(input.episode)}`),
  run: async (ctx, input) => {
    const rows = await listSceneIndex(ctx.gate.scope)
    const scenes = rows
      .filter((row) => input.episode === undefined || row.episodeOrdinal === input.episode)
      .map((row) => ({
        sceneId: row.sceneNodeId,
        ref: formatSceneRef(sceneRefOf(row)),
        episode: row.episodeOrdinal,
        number: row.ordinalInEpisode,
        heading: row.heading,
        lines: row.lines,
        dialogueWords: row.words,
      }))
    return { ok: true, content: { count: scenes.length, scenes }, summary: plural(scenes.length, 'scene') }
  },
})

export const CORE_TOOLS: readonly Tool[] = [listScenes]
