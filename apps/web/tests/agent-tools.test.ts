// @vitest-environment node
import type { AgentEvent, Episode, Project } from '@folio/contracts'
import { episodeId, episodeSlug, projectId, userId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import type { ProposedOp, Toolset } from '../lib/agent/registry'
import type { NodeId, RunId } from '@folio/script'
import { documentId, nodeId, parseFountain, typed } from '@folio/script'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { z } from 'zod'

/**
 * The Phase 2 read tools (roadmap task 2.5), each run against one seeded
 * project - "Harbour Lights", a film of two scenes - with the repositories
 * underneath answering from the fixture. Nothing needs a database (CLAUDE.md):
 * the seed is the mocks. Where a tool wraps an action, the action's own gate
 * runs for real over mocked identity and membership, which is how a removed
 * member is shown to be refused.
 *
 * Three promises are checked beside the tools themselves:
 *   - **`tools.md` is the catalogue.** Every registered tool is a Phase 2 row
 *     there with the same role and mode, and every Phase 2 row is registered.
 *   - **A tool refuses a caller below its minimum role**, with the gate's words.
 *   - **Research stays unread**: no source or clip text leaves `read_research`.
 */

const ME = userId('00000000-0000-4000-8000-0000000000aa')
const PROJECT_ID = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE_ID = episodeId('7a1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c11')
const SCRIPT_DOC = documentId('8a1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c12')
const OUTLINE_DOC = documentId('9a1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c13')
const MEERA = '30000000-0000-4000-8000-000000000001'
const HARBOUR = '40000000-0000-4000-8000-000000000001'
const RUN = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21' as RunId

const PROJECT = {
  id: PROJECT_ID,
  title: 'Harbour Lights',
  kind: 'screenwriting',
  projectType: 'film',
  format: 'hollywood',
  pageMode: 'paged',
  liveRepaginate: false,
} as Project
const EPISODE = { id: EPISODE_ID, projectId: PROJECT_ID, slug: episodeSlug('ep_001'), ordinal: 1, title: 'Harbour Lights', revisionColour: 'white' } as Episode

const freshIds = Array.from({ length: 40 }, (_, index) => nodeId(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`))
const parsed = parseFountain(
  ['INT. HARBOUR OFFICE - NIGHT', '', 'MEERA counts the ledgers by lamplight.', '', 'MEERA', 'Forty-one ships. Forty.', '', 'EXT. PIER - DAY', '', 'Gulls over the harbour wall.'].join('\n'),
  { freshIds },
)
if (!parsed.ok) throw new Error('fixture did not parse')
const NODES = parsed.value.nodes
const SCENE_IDS = NODES.filter((node) => node.type === 'scene').map((node) => node.id)
const [SC1, SC2] = SCENE_IDS as [NodeId, NodeId]

const indexRow = (id: NodeId, n: number, heading: string) => ({
  sceneNodeId: id,
  number: n,
  ordinalInEpisode: n,
  heading,
  locationId: null,
  lines: 4,
  words: 4,
  cast: [],
  speaking: [],
  mentioned: [],
  episode: EPISODE.slug,
  episodeOrdinal: 1,
  ie: 'INT',
  light: 'night',
  timeOfDay: 'NIGHT',
})
const INDEX = [indexRow(SC1, 1, 'INT. HARBOUR OFFICE - NIGHT'), indexRow(SC2, 2, 'EXT. PIER - DAY')]
const timelineRow = (id: NodeId, n: number, heading: string, day: number | null) => ({
  sceneNodeId: id,
  documentId: SCRIPT_DOC,
  episode: EPISODE.slug,
  episodeOrdinal: 1,
  number: n,
  heading,
  synopsis: null,
  page: n,
  eighths: 4,
  cast: [],
  locationId: null,
  storyDay: day,
  storyClock: null,
  flashback: false,
  threads: [],
})

const spies = vi.hoisted(() => ({
  identity: vi.fn(),
  membership: vi.fn(),
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
}))

vi.mock('../lib/auth/session', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  currentIdentity: () => spies.identity(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = [
    'transactionDatabase', 'openProjectForRequest', 'readProject', 'readEpisodeBySlug', 'listEpisodes',
    'readEpisodeBoard', 'listSceneIndex', 'listCharacterRecords', 'listLocationRecords', 'listPropRecords',
    'listSceneSynopses', 'listSceneEighths', 'listTimelineScenes', 'readScreenplayNodes', 'readMentionLabels',
    'readProjectScreenplayByEpisode', 'listAgentRuns', 'readAgentRun', 'listLiveGenerations', 'listProjectsFor',
    'readDocumentByKind', 'readMeasurement', 'listSceneMeasurements', 'readLatestLockedPages', 'readOutlineNodes',
    'listBoundCues', 'listBoundSluglines', 'listStoryThreads', 'readProjectScreenplayNodes', 'listFindingVerdicts',
    'listResearchSources', 'listResearchCollections', 'listResearchClips', 'listCueTallies', 'listOpenCueRows',
    'listResolveDecisions', 'listRelationships', 'readMergedInto', 'listClipsFiledToLocations', 'listOpenLocationRows',
    'listSceneStoryTime', 'listSluglineTallies',
  ]
  for (const name of names) spies.db[name] = vi.fn()
  return {
    ...real,
    ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])),
    readMembershipFor: (...args: readonly unknown[]) => spies.membership(...args),
  }
})

vi.mock('../lib/script/server', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  readDerivationReads: () => Promise.resolve({ all: { ok: true, value: [] }, previous: null }),
  deriveSpeculatively: () => null,
}))

await import('../lib/agent/tools')
const { defineTool, registerTools, registeredTools, runTool } = await import('../lib/agent/registry')
const { hrefOfTarget } = await import('../lib/agent/navigate')
const { executorFor } = await import('../lib/agent/executors')
type ToolResult = Awaited<ReturnType<typeof runTool>>
const { ROLE_REFUSED } = await import('../lib/auth/roles')

const SCOPE = {} as ProjectScope<'transaction'>

const seed = (): void => {
  const db = spies.db
  const answer = (name: string, value: unknown): void => {
    db[name]?.mockResolvedValue(value)
  }
  spies.identity.mockResolvedValue({ id: ME })
  spies.membership.mockResolvedValue({ role: 'reader' })
  answer('transactionDatabase', {})
  answer('openProjectForRequest', SCOPE)
  answer('readProject', PROJECT)
  answer('readEpisodeBySlug', EPISODE)
  answer('listEpisodes', [EPISODE])
  answer('readEpisodeBoard', [{ episode: EPISODE, pages: 2 }])
  answer('listSceneIndex', INDEX)
  answer('listCharacterRecords', [{ id: MEERA, name: 'MEERA', derived: { presence: 'present', appearances: 1, lines: 1 } }])
  answer('listLocationRecords', [{ id: HARBOUR, name: 'HARBOUR OFFICE', derived: null, parentId: null }])
  answer('listPropRecords', [])
  answer('listSceneSynopses', new Map([[SC1, 'Meera finds the count is wrong.']]))
  answer('listSceneEighths', new Map([[SC1, 5]]))
  answer('listTimelineScenes', [timelineRow(SC1, 1, 'INT. HARBOUR OFFICE - NIGHT', 2), timelineRow(SC2, 2, 'EXT. PIER - DAY', 1)])
  answer('readScreenplayNodes', { ok: true, value: NODES.map((node) => ({ node })) })
  answer('readMentionLabels', [])
  answer('readProjectScreenplayByEpisode', { ok: true, value: [{ ordinal: 1, title: 'Harbour Lights', slug: 'ep_001', nodes: NODES }] })
  answer('readProjectScreenplayNodes', { ok: true, value: NODES })
  answer('listAgentRuns', [{ id: RUN, status: 'running', mode: 'interactive', startedAt: null, finishedAt: null, error: null }])
  answer('readAgentRun', null)
  answer('listLiveGenerations', [])
  answer('listProjectsFor', [])
  db['readDocumentByKind']?.mockImplementation((...args: readonly unknown[]) =>
    Promise.resolve(args[2] === 'screenplay' ? { id: SCRIPT_DOC } : { id: OUTLINE_DOC }),
  )
  answer('readMeasurement', null)
  answer('listSceneMeasurements', [])
  answer('readLatestLockedPages', [])
  answer('readOutlineNodes', { ok: true, value: [{ node: { id: freshIds[30], provenance: typed(), type: 'h1', content: [{ kind: 'text', text: 'Act One' }] } }] })
  answer('listBoundCues', [{ characterId: MEERA, cue: 'MEERA' }])
  answer('listBoundSluglines', [{ locationId: HARBOUR, slugline: 'HARBOUR OFFICE' }])
  answer('listStoryThreads', [])
  answer('listFindingVerdicts', [])
  answer('listResearchSources', [
    { id: 's1', kind: 'article', title: 'Port records, 1962', origin: 'Archive', note: null, body: 'SECRET SOURCE TEXT', collection: null, clips: 1, createdAt: '', updatedAt: '' },
  ])
  answer('listResearchCollections', [])
  answer('listResearchClips', [{ id: 'c1', sourceId: 's1', text: 'SECRET CLIP TEXT', createdAt: '', filings: [{ id: 'f1', kind: 'scene', sceneNodeId: SC1 }] }])
  for (const empty of ['listCueTallies', 'listOpenCueRows', 'listResolveDecisions', 'listRelationships', 'listClipsFiledToLocations', 'listOpenLocationRows', 'listSceneStoryTime', 'listSluglineTallies']) answer(empty, [])
  answer('readMergedInto', null)
}

const context = (role: 'reader' | 'writer' | 'owner' = 'reader') => {
  const events: AgentEvent[] = []
  const proposed: ProposedOp[] = []
  return {
    events,
    proposed,
    ctx: {
      gate: { actor: ME, scope: SCOPE, project: PROJECT, episode: EPISODE, role },
      runId: RUN,
      idempotencyKey: 'toolu_test',
      emit: (event: AgentEvent) => events.push(event),
      loaded: new Set<Toolset>(),
      // Phase 3: a write tool queues here; nothing is applied by a call.
      proposals: {
        propose: (op: ProposedOp) => {
          proposed.push(op)
        },
        earlier: () => undefined,
        applyNow: () => Promise.resolve({ ok: false as const, message: 'not in this test' }),
      },
    },
  }
}

const call = async (name: string, input: unknown, role: 'reader' | 'writer' | 'owner' = 'reader') => {
  const { ctx, events, proposed } = context(role)
  const result = await runTool(name, input, ctx, registeredTools())
  return { result, events, ctx, proposed }
}

const ok = <T>(result: ToolResult): T => {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result.content as T
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()
})

// ---------------------------------------------------------------------------

describe('the registry against docs/agents/tools.md', () => {
  const catalogue = readFileSync(join(import.meta.dirname, '../../../docs/agents/tools.md'), 'utf8')
  const rows = [...catalogue.matchAll(/^\| `([a-z_]+)` \| [^|]+\| (\w+) \| ([^|]+) \| ([^|]+) \|$/gmu)].map((match) => ({
    name: match[1] ?? '',
    role: match[2] ?? '',
    mode: (match[3] ?? '').trim(),
    phase: (match[4] ?? '').trim(),
  }))
  const phaseTwo = rows.filter((row) => row.phase.startsWith('2'))
  const built = rows.filter((row) => row.phase.startsWith('2') || row.phase.startsWith('3'))

  it('registers every Phase 2 and Phase 3 tool the catalogue lists, and nothing it does not', () => {
    expect(phaseTwo.length).toBe(17)
    expect(built.length).toBe(56)
    expect(registeredTools().map((tool) => tool.name).sort()).toEqual(built.map((row) => row.name).sort())
  })

  it('gives each tool the catalogue`s role and mode - a "propose · confirm" tool is registered as propose and confirms its destructive action', () => {
    for (const tool of registeredTools()) {
      const row = built.find((entry) => entry.name === tool.name)
      expect(row, tool.name).toBeDefined()
      expect(tool.minimumRole ?? 'user', tool.name).toBe(row?.role)
      expect(tool.mode, tool.name).toBe(row?.mode.split(' · ')[0])
    }
  })

  it('registers no paid tool before Phase 5, and no Research write at all (ruling R3)', () => {
    expect(registeredTools().filter((tool) => tool.mode === 'paid')).toEqual([])
    expect(registeredTools().filter((tool) => tool.toolset === 'research' && tool.mode !== 'read')).toEqual([])
  })

  it('gives every write tool an executor under its own name, so a stored operation can be applied', () => {
    // `start_story_project` excepted: outside a project there is no proposal to store; the launcher's confirmation creates it.
    for (const tool of registeredTools().filter((entry) => entry.mode !== 'read' && entry.mode !== 'client' && entry.name !== 'start_story_project')) {
      expect(executorFor(tool.name), tool.name).toBeDefined()
    }
  })
})

describe('the minimum role', () => {
  it('refuses a caller below it, in the gate`s words', async () => {
    registerTools([
      defineTool({
        name: 'test_writer_read',
        description: 'A writer-minimum tool, for this test only.',
        toolset: 'core',
        minimumRole: 'writer',
        mode: 'read',
        input: z.object({}),
        label: () => 'Testing',
        run: () => Promise.resolve({ ok: true, content: {}, summary: 'ran' }),
      }),
    ])
    expect((await call('test_writer_read', {}, 'reader')).result).toEqual({ ok: false, message: ROLE_REFUSED })
    expect((await call('test_writer_read', {}, 'writer')).result).toMatchObject({ ok: true })
    expect((await call('test_writer_read', {}, 'owner')).result).toMatchObject({ ok: true })
  })

  it('refuses a caller whose membership is gone, through the wrapped action`s own gate', async () => {
    spies.membership.mockResolvedValue(null)
    const { result } = await call('read_scene', { sceneId: SC1 })
    expect(result).toEqual({ ok: false, message: 'That script could not be found.' })
  })
})

describe('core', () => {
  it('get_project_overview counts what the project holds', async () => {
    const { result } = await call('get_project_overview', {})
    expect(ok(result)).toMatchObject({ title: 'Harbour Lights', totals: { scenes: 2, pages: 2, characters: 1, locations: 1, props: 0 } })
  })

  it('list_scenes lists every scene with its citation, length and synopsis', async () => {
    const content = ok<{ count: number; scenes: { ref: string; length: string | null; synopsis: string | null }[] }>((await call('list_scenes', {})).result)
    expect(content.count).toBe(2)
    expect(content.scenes[0]).toMatchObject({ ref: 'E1 Sc 1', length: '5/8 pp', synopsis: 'Meera finds the count is wrong.' })
    expect(ok<{ count: number }>((await call('list_scenes', { episode: 2 })).result).count).toBe(0)
  })

  it('read_scene reads one scene`s lines through the Timeline reader', async () => {
    const content = ok<{ ref: string; lines: unknown[] }>((await call('read_scene', { sceneId: SC1 })).result)
    expect(content.ref).toBe('E1 Sc 1')
    expect(JSON.stringify(content.lines)).toContain('Forty-one ships')
  })

  it('search_project finds lines with their scenes, and records by name', async () => {
    const content = ok<{ lines: { ref: string; text: string }[]; records: { name: string }[] }>((await call('search_project', { query: 'harbour' })).result)
    expect(content.lines.map((line) => line.ref)).toEqual(['E1 Sc 1', 'E1 Sc 2'])
    expect(content.records.map((record) => record.name)).toEqual(['HARBOUR OFFICE'])
  })

  it('navigate resolves a scene to its episode and shape, and the panel builds the URL with hrefs.ts', async () => {
    const { result, events } = await call('navigate', { route: 'script', sceneId: SC2 })
    expect(result).toMatchObject({ ok: true, summary: 'Opened Script' })
    const event = events[0]
    if (event?.type !== 'navigate') throw new Error('expected a navigate event')
    expect(event.target).toEqual({ kind: 'episode', projectId: PROJECT_ID, shape: 'collapsed', episode: 'ep_001', route: 'script', sceneNodeId: SC2 })
    expect(hrefOfTarget(event.target)).toBe(`/app/project/${PROJECT_ID}/script#n-${SC2}`)
  })

  it('navigate opens a record page, a project route, and refuses a scene that is not there', async () => {
    const record = await call('navigate', { route: 'characters', recordId: MEERA })
    const target = record.events[0]
    expect(target?.type === 'navigate' ? hrefOfTarget(target.target) : null).toBe(`/app/project/${PROJECT_ID}/characters/${MEERA}`)
    const route = await call('navigate', { route: 'timeline' })
    const timeline = route.events[0]
    expect(timeline?.type === 'navigate' ? hrefOfTarget(timeline.target) : null).toBe(`/app/project/${PROJECT_ID}/timeline`)
    expect((await call('navigate', { route: 'script', sceneId: '00000000-0000-4000-8000-000000000999' })).result).toMatchObject({ ok: false })
  })

  it('load_toolset adds a route`s tools for the rest of the turn, and never the launcher`s', async () => {
    const { result, ctx } = await call('load_toolset', { toolset: 'timeline' })
    // Its reads, and since Phase 3 its writes.
    expect(ok<{ tools: string[] }>(result).tools).toEqual(['run_continuity_check', 'export_chronology', 'set_story_time', 'place_scenes', 'manage_threads', 'mark_finding_deliberate'])
    expect(ctx.loaded.has('timeline')).toBe(true)
    expect((await call('load_toolset', { toolset: 'launcher' })).result).toMatchObject({ ok: false })
  })

  it('get_run_status reads the runs and the live generations', async () => {
    expect(ok<{ runs: { id: string }[] }>((await call('get_run_status', {})).result).runs.map((run) => run.id)).toEqual([RUN])
    expect((await call('get_run_status', { runId: RUN })).result).toMatchObject({ ok: false })
  })
})

describe('launcher', () => {
  it('list_projects and open_project read only the caller`s memberships', async () => {
    expect(ok<{ projects: unknown[] }>((await call('list_projects', {})).result).projects).toEqual([])
    const opened = await call('open_project', { projectId: PROJECT_ID })
    expect(opened.result).toEqual({ ok: false, message: 'That project could not be found.' })
    expect(opened.events).toEqual([])
  })
})

describe('script', () => {
  it('get_page_count measures the episode with the engine', async () => {
    const content = ok<{ source: string; pages: number; perScene: unknown[] }>((await call('get_page_count', {})).result)
    expect(content.source).toBe('computed')
    expect(content.pages).toBeGreaterThan(0)
    expect(content.perScene).toHaveLength(2)
  })

  it('export_script hands the writer a Fountain and a Final Draft file, not the model', async () => {
    const fountain = await call('export_script', { format: 'fountain' })
    expect(fountain.result).toMatchObject({ ok: true, summary: 'Downloaded Harbour-Lights.fountain' })
    const file = fountain.events[0]
    expect(file?.type === 'download' ? file.text : '').toContain('INT. HARBOUR OFFICE - NIGHT')
    expect(JSON.stringify(fountain.result)).not.toContain('Forty-one')
    const fdx = await call('export_script', { format: 'fdx' })
    expect(fdx.events[0]).toMatchObject({ type: 'download', filename: 'Harbour-Lights.fdx', mime: 'application/xml' })
  })

  it('export_outline hands over the saved outline as Markdown', async () => {
    const { events } = await call('export_outline', {})
    expect(events[0]).toMatchObject({ type: 'download', filename: 'harbour-lights-outline.md' })
  })
})

describe('entities', () => {
  it('preview_rename counts what a rename would rewrite, and writes nothing', async () => {
    const { result } = await call('preview_rename', { entity: 'character', id: MEERA, name: 'MIRA' })
    expect(result).toMatchObject({ ok: true, summary: '1 cue would change' })
  })

  it('export_entities_csv hands over the characters and the locations sheets', async () => {
    spies.db['listCharacterRecords']?.mockResolvedValue([])
    spies.db['listLocationRecords']?.mockResolvedValue([])
    expect((await call('export_entities_csv', { sheet: 'characters' })).events[0]).toMatchObject({ type: 'download', filename: 'characters.csv' })
    expect((await call('export_entities_csv', { sheet: 'locations' })).events[0]).toMatchObject({ type: 'download', filename: 'locations.csv' })
    expect((await call('export_entities_csv', { sheet: 'locations', episode: 4 })).result).toMatchObject({ ok: false })
  })
})

describe('timeline', () => {
  it('run_continuity_check reports the open finding the Timeline draws', async () => {
    const content = ok<{ open: { scene: string; kind: string }[]; storyDays: number }>((await call('run_continuity_check', {})).result)
    expect(content.open).toEqual([expect.objectContaining({ scene: 'E1 Sc 2', kind: 'order' })])
    expect(content.storyDays).toBe(2)
  })

  it('export_chronology hands over the chronology', async () => {
    expect((await call('export_chronology', {})).events[0]).toMatchObject({ type: 'download', filename: 'harbour-lights-chronology.md' })
  })
})

describe('research', () => {
  it('read_research reports the library`s shape and none of its text (the readable toggle does not exist yet)', async () => {
    const { result } = await call('read_research', {})
    const content = ok<{ readable: boolean; sources: { title: string; clips: number; filedTo: unknown[] }[] }>(result)
    expect(content.readable).toBe(false)
    expect(content.sources[0]).toMatchObject({ title: 'Port records, 1962', clips: 1, filedTo: [{ kind: 'scene', scene: 'E1 Sc 1' }] })
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
})
