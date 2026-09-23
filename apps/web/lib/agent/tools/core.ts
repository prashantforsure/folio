import type { AgentRoute, NavigateTarget } from '@folio/contracts'
import { AgentRouteSchema, AGENT_EPISODE_ROUTES, NodeIdSchema } from '@folio/contracts'
import {
  listAgentRuns,
  listCharacterRecords,
  listEpisodes,
  listLiveGenerations,
  listLocationRecords,
  listPropRecords,
  listSceneEighths,
  listSceneIndex,
  listSceneSynopses,
  readAgentRun,
  readEpisodeBoard,
  readMentionLabels,
  readProjectScreenplayByEpisode,
} from '@folio/db'
import { RunIdSchema } from '@folio/contracts'
import { formatEighths } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../../auth/roles'
import { formatSceneRef, sceneRefOf } from '../../characters/figures'
import { readSceneLines } from '../../timeline/actions'
import { ROUTE_TITLE } from '../../workspace/routes'
import { TOOLSETS, defineTool, registeredTools } from '../registry'
import type { Tool, ToolContext, Toolset } from '../registry'
import { searchProject } from '../search'

/**
 * The core toolset - `docs/agents/tools.md`, *Core - always loaded*.
 *
 * Every turn offers these, whatever the route. Each is a **read**, or a
 * **client** tool the panel carries out (`navigate`): none writes anything
 * (AGENTS.md ruling **R8**, read-only until Phase 3). Counts in a result are
 * computed here, so the model has a number to quote rather than one to work
 * out (ruling **R4**). Where an action already answers the question
 * (`readSceneLines`), the tool calls it, and it re-checks the gate as it does
 * for the browser (integration plan, design choice 1).
 */

const plural = (count: number, one: string, many = `${one}s`): string => `${String(count)} ${count === 1 ? one : many}`

const EpisodeNumber = z.number().int().min(1).describe('An episode number - its place in the running order, 1 for the first.')

/** A sub-object of the gate the reads here need: the scope and the project's format. */
const scopeOf = (ctx: ToolContext) => ctx.gate.scope

// ---------------------------------------------------------------------------

export const getProjectOverview = defineTool({
  name: 'get_project_overview',
  description:
    'Read the project at a glance: its title and format, each episode with its scene and page counts, how many characters, locations and props it has, and the busiest characters. ' +
    'Use it first when a question is about the project as a whole.',
  toolset: 'core',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({}),
  label: () => 'Reading the project',
  run: async (ctx) => {
    const scope = scopeOf(ctx)
    const { project } = ctx.gate
    const [board, index, characters, locations, props] = await Promise.all([
      readEpisodeBoard(scope, project.format),
      listSceneIndex(scope),
      listCharacterRecords(scope),
      listLocationRecords(scope),
      listPropRecords(scope),
    ])
    const present = characters.filter((record) => record.derived === null || record.derived.presence === 'present')
    const episodes = board.map(({ episode, pages }) => ({
      number: episode.ordinal,
      title: episode.title,
      scenes: index.filter((row) => row.episodeOrdinal === episode.ordinal).length,
      pages,
    }))
    const busiest = [...present]
      .sort((a, b) => (b.derived?.appearances ?? 0) - (a.derived?.appearances ?? 0))
      .slice(0, 8)
      .map((record) => ({ name: record.name, scenes: record.derived?.appearances ?? 0, lines: record.derived?.lines ?? 0 }))
    const pagesKnown = board.every((entry) => entry.pages !== null)
    return {
      ok: true,
      content: {
        title: project.title,
        type: project.projectType,
        format: project.format,
        episodes,
        totals: {
          scenes: index.length,
          pages: pagesKnown ? board.reduce((total, entry) => total + (entry.pages ?? 0), 0) : null,
          characters: present.length,
          locations: locations.length,
          props: props.length,
        },
        busiestCharacters: busiest,
        note: pagesKnown ? null : 'An episode with pages null has not been measured yet; get_page_count measures it.',
      },
      summary: `${plural(episodes.length, 'episode')}, ${plural(index.length, 'scene')}`,
    }
  },
})

export const listScenes = defineTool({
  name: 'list_scenes',
  description:
    'List the scenes of the script in running order: each scene\'s citation ("E1 Sc 3"), its id, heading, length in eighths of a page, lines, dialogue words and synopsis. ' +
    'Pass an episode number to list only that episode. Use this before answering any question about which scenes exist, how many there are, or where something happens.',
  toolset: 'core',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({ episode: EpisodeNumber.optional() }),
  label: (input) => (input.episode === undefined ? 'Reading the scene list' : `Reading the scenes of episode ${String(input.episode)}`),
  run: async (ctx, input) => {
    const scope = scopeOf(ctx)
    const [rows, synopses, eighths] = await Promise.all([listSceneIndex(scope), listSceneSynopses(scope), listSceneEighths(scope, ctx.gate.project.format)])
    const scenes = rows
      .filter((row) => input.episode === undefined || row.episodeOrdinal === input.episode)
      .map((row) => {
        const length = eighths.get(row.sceneNodeId)
        return {
          sceneId: row.sceneNodeId,
          ref: formatSceneRef(sceneRefOf(row)),
          episode: row.episodeOrdinal,
          number: row.ordinalInEpisode,
          heading: row.heading,
          length: length === undefined ? null : `${formatEighths(length)} pp`,
          lines: row.lines,
          dialogueWords: row.words,
          synopsis: synopses.get(row.sceneNodeId) ?? null,
        }
      })
    return { ok: true, content: { count: scenes.length, scenes }, summary: plural(scenes.length, 'scene') }
  },
})

export const readScene = defineTool({
  name: 'read_scene',
  description:
    'Read one scene\'s text - its heading and every line under it, as the page prints them. Takes the scene id list_scenes or search_project gave. ' +
    'Read a scene before quoting it or answering a question about what happens in it.',
  toolset: 'core',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({ sceneId: NodeIdSchema.describe('The scene id (its heading node id).') }),
  label: () => 'Reading a scene',
  run: async (ctx, input) => {
    const [result, index] = await Promise.all([readSceneLines(ctx.gate.project.id, input.sceneId), listSceneIndex(scopeOf(ctx))])
    if (result.status !== 'ok') return { ok: false, message: result.message }
    const row = index.find((entry) => entry.sceneNodeId === input.sceneId)
    const ref = row === undefined ? null : formatSceneRef(sceneRefOf(row))
    return { ok: true, content: { ref, lines: result.lines }, summary: `${ref ?? 'The scene'} · ${plural(result.lines.length, 'line')}` }
  },
})

export const searchProjectTool = defineTool({
  name: 'search_project',
  description:
    'Search every episode\'s script for words, and the characters, locations and props for a name. Returns each matching line with the scene it is in, and each matching record. ' +
    'Case does not matter. Use it to find where something is said or happens before reading the scene.',
  toolset: 'core',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({ query: z.string().trim().min(2).max(200).describe('The words to find.') }),
  label: (input) => `Searching for "${input.query}"`,
  run: async (ctx, input) => {
    const scope = scopeOf(ctx)
    const [runs, labels, characters, locations, props] = await Promise.all([
      readProjectScreenplayByEpisode(scope),
      readMentionLabels(scope),
      listCharacterRecords(scope),
      listLocationRecords(scope),
      listPropRecords(scope),
    ])
    if (!runs.ok) return { ok: false, message: 'The script could not be read for a search.' }
    const book = new Map(labels.map((label) => [`${label.entity}:${label.id}`, label.label]))
    const result = searchProject(
      runs.value,
      [
        ...characters.map((record) => ({ entity: 'character' as const, id: record.id as string, name: record.name })),
        ...locations.map((record) => ({ entity: 'location' as const, id: record.id as string, name: record.name })),
        ...props.map((record) => ({ entity: 'prop' as const, id: record.id as string, name: record.name })),
      ],
      input.query,
      (target) => book.get(`${target.entity}:${target.id}`),
    )
    return {
      ok: true,
      content: result,
      summary: `${plural(result.lineCount, 'line')}, ${plural(result.records.length, 'record')}`,
    }
  },
})

/** The routes with a page per record, and what the record is. */
const RECORD_ENTITY: Partial<Record<AgentRoute, 'character' | 'location' | 'prop' | 'research'>> = {
  characters: 'character',
  locations: 'location',
  props: 'prop',
  research: 'research',
}

/**
 * `navigate` - a **client** tool: the server resolves where, the panel goes
 * there (`lib/agent/navigate.ts`, `router.push`). The shape and the episode
 * are decided here by `enterEpisodeRoute`'s rules - a film has no episode
 * segment, a series always does, and a scene decides its own episode - so the
 * panel builds the URL without deciding anything.
 */
export const navigate = defineTool({
  name: 'navigate',
  description:
    "Take the writer to a place in the app: a route (script, outline, storyboard, scenes, production, characters, locations, props, timeline, research), a scene in the script, or one character's, location's, prop's or research source's page. " +
    'Use it when the answer is somewhere the writer should look, after you have found it.',
  toolset: 'core',
  minimumRole: ROLE.read,
  mode: 'client',
  input: z.object({
    route: AgentRouteSchema.describe('Where to go.'),
    episode: EpisodeNumber.optional().describe('For an episode route: which episode. Omit for the one the writer has open.'),
    sceneId: NodeIdSchema.optional().describe('With route "script": the scene to scroll to. Its episode wins over `episode`.'),
    recordId: z.uuid().optional().describe('With route characters, locations, props or research: open that record\'s page.'),
  }),
  label: (input) => `Opening ${ROUTE_TITLE[input.route]}`,
  run: async (ctx, input) => {
    const { project } = ctx.gate
    let target: NavigateTarget
    if ((AGENT_EPISODE_ROUTES as readonly string[]).includes(input.route)) {
      const route = z.enum(AGENT_EPISODE_ROUTES).parse(input.route)
      const [episodes, index] = await Promise.all([listEpisodes(ctx.gate.scope), input.sceneId === undefined ? Promise.resolve([]) : listSceneIndex(ctx.gate.scope)])
      const scene = input.sceneId === undefined ? undefined : index.find((row) => row.sceneNodeId === input.sceneId)
      if (input.sceneId !== undefined && scene === undefined) return { ok: false, message: 'There is no such scene in this project.' }
      const ordinal = scene?.episodeOrdinal ?? input.episode ?? ctx.gate.episode.ordinal
      const episode = episodes.find((entry) => entry.ordinal === ordinal)
      if (episode === undefined) return { ok: false, message: `There is no episode ${String(ordinal)}.` }
      target = {
        kind: 'episode',
        projectId: project.id,
        shape: project.projectType === 'film' ? 'collapsed' : 'episodic',
        episode: episode.slug,
        route,
        ...(route === 'script' && scene !== undefined ? { sceneNodeId: scene.sceneNodeId } : {}),
      }
    } else if (input.recordId !== undefined) {
      const entity = RECORD_ENTITY[input.route]
      if (entity === undefined) return { ok: false, message: 'Only characters, locations, props and research have record pages.' }
      target = { kind: 'record', projectId: project.id, entity, id: input.recordId }
    } else {
      target = { kind: 'route', projectId: project.id, route: z.enum(['characters', 'locations', 'props', 'timeline', 'research']).parse(input.route) }
    }
    ctx.emit({ type: 'navigate', target })
    return { ok: true, content: { opened: target }, summary: `Opened ${ROUTE_TITLE[input.route]}` }
  },
})

/**
 * `load_toolset` - D13's escape hatch: a task that crosses routes loads the
 * other route's reads for the rest of the turn. The launcher set is never
 * loadable inside a project.
 */
export const loadToolset = defineTool({
  name: 'load_toolset',
  description:
    'Load another route\'s tools for the rest of this turn: "script" (page counts, script and outline exports), "entities" (rename previews, character and location CSVs), ' +
    '"timeline" (the continuity check, the chronology), "research" (the research library). The core tools are always loaded.',
  toolset: 'core',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({ toolset: z.enum(TOOLSETS).exclude(['core', 'launcher']) }),
  label: (input) => `Loading the ${input.toolset} tools`,
  run: (ctx, input) => {
    ctx.loaded.add(input.toolset satisfies Toolset)
    const names = registeredTools()
      .filter((tool) => tool.toolset === input.toolset)
      .map((tool) => tool.name)
    return Promise.resolve({ ok: true, content: { loaded: input.toolset, tools: names }, summary: `${plural(names.length, 'tool')} loaded` })
  },
})

export const getRunStatus = defineTool({
  name: 'get_run_status',
  description:
    "Read the status of agent runs on this project (this one, or a run id you were given) and of the episode's image and video generations that are queued or running.",
  toolset: 'core',
  minimumRole: ROLE.read,
  mode: 'read',
  input: z.object({ runId: RunIdSchema.optional().describe('A run id. Omit for the most recent runs.') }),
  label: () => 'Reading run status',
  run: async (ctx, input) => {
    const scope = scopeOf(ctx)
    const [runs, generations] = await Promise.all([
      input.runId === undefined ? listAgentRuns(scope, { limit: 5 }) : readAgentRun(scope, input.runId).then((run) => (run === null ? [] : [run])),
      listLiveGenerations(scope, ctx.gate.episode.id),
    ])
    if (input.runId !== undefined && runs.length === 0) return { ok: false, message: 'There is no such run on this project.' }
    return {
      ok: true,
      content: {
        runs: runs.map((run) => ({ id: run.id, status: run.status, mode: run.mode, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error })),
        generations: generations.map((generation) => ({ id: generation.id, job: generation.job, state: generation.state, progress: generation.progress, target: generation.targetType })),
      },
      summary: `${plural(runs.length, 'run')}, ${plural(generations.length, 'live generation')}`,
    }
  },
})

export const CORE_TOOLS: readonly Tool[] = [getProjectOverview, listScenes, readScene, searchProjectTool, navigate, loadToolset, getRunStatus]
