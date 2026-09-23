// @vitest-environment node
import type { AgentEvent, Episode, Project } from '@folio/contracts'
import { agentProposalId, episodeId, episodeSlug, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { nodeId } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProposedOp, Tool, Toolset } from '../lib/agent/registry'
import { RUN, store } from './fake-proposals'

/**
 * The entity, scene and timeline write tools - roadmap task 3.5.
 *
 * Every wrapped action is mocked; the proposal tables are the in-memory
 * store. For each tool what is held is the whole life of one call: what it
 * **proposes** (and that proposing changes nothing), what **applying** it
 * calls - the route's own action, with the operation's idempotency key where
 * the action takes one - the **undo record** it keeps, and what **undoing the
 * run** does with it, including when the writer has changed the thing since.
 * Renames preview first and keep the restore payload; merges and deletes ask
 * for confirmation and cannot be undone.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  actions: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  readContinuity: vi.fn(),
}))

const mocked = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.actions[name]?.(...args)]))
/** A core module (roadmap task 4.2): each `<name>With` export answers through the spy the test names `<name>`. */
const cores = (names: readonly string[], prefix = '') => Object.fromEntries(names.map((name) => [`${name}With`, (...args: readonly unknown[]) => spies.actions[`${prefix}${name}`]?.(...args)]))

const CHARACTER_ACTIONS = ['deleteCharacter', 'deleteRelationship', 'mergeCharacters', 'previewRename', 'renameCharacter', 'resolveCue', 'revokeDecision', 'saveProfile', 'saveRelationship', 'undoRename']
const LOCATION_ACTIONS = ['createLocation', 'deleteLocation', 'mergeLocations', 'previewRename', 'renameLocation', 'resolveSlugline', 'resolveStructure', 'revokeDecision', 'saveLocation', 'setParent', 'undoRename']

vi.mock('../lib/characters/core', () => cores(CHARACTER_ACTIONS, 'character.'))
vi.mock('../lib/locations/core', () => cores(LOCATION_ACTIONS, 'location.'))
vi.mock('../lib/characters/create', () => mocked(['createCharacterIn']))
vi.mock('../lib/props/core', () => cores(['createProp', 'deleteProp', 'mergeProps', 'renameProp', 'saveProp']))
vi.mock('../lib/timeline/core', () => cores(['createThread', 'deleteThread', 'markDeliberate', 'orderThreads', 'placeScenes', 'reopenFinding', 'saveStoryTime', 'saveThread', 'setSceneThreads', 'unplaceScenes']))
vi.mock('../lib/scenes/core', () => cores(['saveSynopsis']))
vi.mock('../lib/timeline/server', () => ({ readContinuity: (...args: readonly unknown[]) => spies.readContinuity(...args) }))
vi.mock('../lib/timeline/view', async (actual) => ({ ...(await actual<Record<string, unknown>>()), findingNote: () => 'Steps back from day 3' }))
vi.mock('../lib/script/server', async (actual) => ({ ...(await actual<Record<string, unknown>>()), rederiveProject: () => Promise.resolve({ ok: true, derivation: null }) }))
vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const { repository } = await import('./fake-proposals')
  const names = [
    'listCharacterRecords',
    'listLocationRecords',
    'listPropRecords',
    'listRelationships',
    'listEpisodes',
    'readDocumentByKind',
    'readDocumentById',
    'readScreenplayNodes',
    'listSceneIndex',
    'listStoryThreads',
    'readSceneAuthored',
    'readFindingVerdict',
    'snapshotVersion',
    'logAgentActivity',
    'readMembershipFor',
    'transactionDatabase',
  ]
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...repository, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})

const { ENTITY_WRITE_TOOLS } = await import('../lib/agent/tools/writes-entities')
const { TIMELINE_WRITE_TOOLS } = await import('../lib/agent/tools/writes-timeline')
const { registerExecutors } = await import('../lib/agent/executors')
const { executorsOf } = await import('../lib/agent/write-tool')
const { runTool } = await import('../lib/agent/registry')
const { applyProposalWith, undoRunWith } = await import('../lib/agent/apply')
const { groupsOf } = await import('../lib/agent/loop')
const { repository } = await import('./fake-proposals')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const MEERA = '30000000-0000-4000-8000-000000000001'
const MIRA = '30000000-0000-4000-8000-000000000002'
const WARD = '40000000-0000-4000-8000-000000000001'
const HOSPITAL = '40000000-0000-4000-8000-000000000002'
const SCENE = nodeId('50000000-0000-4000-8000-000000000001')
const THREAD = '60000000-0000-4000-8000-000000000001'

const gate = (role: 'reader' | 'writer' | 'owner' = 'writer') => ({
  actor: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b' as never,
  scope: {} as ProjectScope<'transaction'>,
  project: { id: PROJECT, format: 'hollywood', projectType: 'film' } as Project,
  episode: EPISODE,
  role,
})

/** A core's first argument (roadmap task 4.2): the gate the tool runs as, not the project id. */
const GATE = expect.objectContaining({ project: expect.objectContaining({ id: PROJECT }) })

const TOOLS: readonly Tool[] = [...ENTITY_WRITE_TOOLS, ...TIMELINE_WRITE_TOOLS].map((entry) => entry.tool)

beforeAll(() => {
  registerExecutors([...executorsOf(ENTITY_WRITE_TOOLS), ...executorsOf(TIMELINE_WRITE_TOOLS)])
})

const character = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, color: 'sky', gender: null, age: null, role: 'A nurse', bio: null, appearance: null, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  for (const key of Object.keys(spies.actions)) delete spies.actions[key]
  spies.db.listCharacterRecords?.mockResolvedValue([character(MEERA, 'MEERA'), character(MIRA, 'MIRA')])
  spies.db.listLocationRecords?.mockResolvedValue([
    { id: WARD, name: 'WARD', parentId: null },
    { id: HOSPITAL, name: 'HOSPITAL', parentId: null },
  ])
  spies.db.listPropRecords?.mockResolvedValue([])
  spies.db.listRelationships?.mockResolvedValue([])
  spies.db.listEpisodes?.mockResolvedValue([EPISODE])
  spies.db.readDocumentByKind?.mockResolvedValue(null)
  spies.db.listSceneIndex?.mockResolvedValue([{ sceneNodeId: SCENE, episodeOrdinal: 1, ordinalInEpisode: 3, number: 3 }])
  spies.db.listStoryThreads?.mockResolvedValue([{ id: THREAD, name: 'The letter', colour: 'ochre', position: 0 }])
  spies.db.readSceneAuthored?.mockResolvedValue({ synopsis: 'Meera returns.', storyDay: 2, storyClock: null, flashback: false, threads: [] })
  spies.db.snapshotVersion?.mockResolvedValue({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
  spies.db.logAgentActivity?.mockResolvedValue(undefined)
  spies.db.readMembershipFor?.mockResolvedValue({ role: 'writer' })
  spies.db.transactionDatabase?.mockResolvedValue({})
})

const action = (name: string) => {
  const spy = vi.fn()
  spies.actions[name] = spy
  return spy
}

/** Call a tool as the model would, and see what it queued. */
const propose = async (name: string, input: unknown, role: 'reader' | 'writer' | 'owner' = 'writer') => {
  const proposed: ProposedOp[] = []
  const events: AgentEvent[] = []
  const result = await runTool(
    name,
    input,
    {
      gate: gate(role),
      runId: RUN,
      idempotencyKey: `toolu_${name}`,
      emit: (event) => events.push(event),
      loaded: new Set<Toolset>(),
      proposals: {
        propose: (op) => {
          proposed.push(op)
        },
        earlier: () => undefined,
        applyNow: () => Promise.resolve({ ok: false, message: 'not here' }),
      },
    },
    TOOLS,
  )
  return { result, proposed }
}

/** What the loop does next: store the queued operations as one proposal. */
const stage = async (proposed: readonly ProposedOp[], key = `toolu_${String(Math.random())}`): Promise<string> => {
  const made = await repository.createProposal(gate().scope, {
    runId: RUN,
    episodeId: EPISODE.id,
    summary: proposed.map((op) => op.description).join('; '),
    base: { documents: [] },
    needsConfirmation: proposed.some((op) => op.mode === 'confirm'),
    creditCost: null,
    ops: proposed.map((op, index) => ({ tool: op.tool, args: op.args, mode: op.mode, idempotencyKey: `${key}:${String(index)}` })),
  })
  return made.proposal.id
}

const proposeAndApply = async (name: string, input: unknown, confirmed = false) => {
  const { result, proposed } = await propose(name, input)
  if (!result.ok) throw new Error(result.message)
  const id = await stage(proposed)
  const outcome = await applyProposalWith(gate(), agentProposalId(id), { confirmed })
  return { id, outcome, proposed }
}

describe('proposing changes nothing', () => {
  it('queues one operation, tells the model it waits for the writer, and calls no action', async () => {
    const createCharacterIn = action('createCharacterIn')
    const { result, proposed } = await propose('create_character', { name: 'KAMLA', role: 'The landlady' })
    expect(result).toMatchObject({ ok: true, summary: 'Proposed: Create the character KAMLA' })
    expect(proposed).toEqual([{ tool: 'create_character', args: { name: 'KAMLA', role: 'The landlady' }, mode: 'propose', description: 'Create the character KAMLA', base: undefined, mergeKey: undefined }])
    expect(createCharacterIn).not.toHaveBeenCalled()
  })

  it("refuses a reader a writer's tool with the gate's words", async () => {
    const { result } = await propose('create_character', { name: 'KAMLA' }, 'reader')
    expect(result).toEqual({ ok: false, message: "Your role on this project doesn't allow that." })
  })

  it('refuses a character that already exists rather than proposing a second', async () => {
    expect((await propose('create_character', { name: 'meera' })).result).toMatchObject({ ok: false })
  })
})

describe('characters, locations, props', () => {
  it('create_character makes an agent-origin record with the operation`s key, and its undo deletes it (D11)', async () => {
    const create = action('createCharacterIn').mockResolvedValue('30000000-0000-4000-8000-000000000009')
    const remove = action('character.deleteCharacter').mockResolvedValue({ status: 'deleted' })
    const { outcome, id } = await proposeAndApply('create_character', { name: 'KAMLA' })
    expect(outcome.status).toBe('applied')
    expect(create.mock.calls[0]?.slice(1)).toEqual([{ name: 'KAMLA' }, store.get(id)?.ops[0]?.idempotencyKey, 'agent'])
    await undoRunWith(gate(), RUN)
    expect(remove).toHaveBeenCalledWith(GATE, '30000000-0000-4000-8000-000000000009')
  })

  it('leaves a created character the script now uses, and says why', async () => {
    action('createCharacterIn').mockResolvedValue('30000000-0000-4000-8000-000000000009')
    action('character.deleteCharacter').mockResolvedValue({ status: 'refused', message: 'KAMLA is in the script.' })
    await proposeAndApply('create_character', { name: 'KAMLA' })
    const undo = await undoRunWith(gate(), RUN)
    expect(undo.status !== 'refused' && undo.skipped).toEqual([{ tool: 'create_character', description: 'Create the character KAMLA', reason: 'Kept: KAMLA is in the script.' }])
  })

  it('update_character saves only the named fields and keeps the values they overwrote', async () => {
    const save = action('character.saveProfile').mockResolvedValue({ status: 'saved' })
    const { id } = await proposeAndApply('update_character', { id: MEERA, edit: { role: 'A night-shift nurse' } })
    expect(save).toHaveBeenCalledWith(GATE, MEERA, { role: 'A night-shift nurse' })
    expect(store.get(id)?.ops[0]?.undo).toEqual({ role: 'A nurse' })
    expect(store.get(id)?.proposal.summary).toBe('Update MEERA: role')
  })

  it('undoes an update when the field still reads as the agent left it', async () => {
    const save = action('character.saveProfile').mockResolvedValue({ status: 'saved' })
    await proposeAndApply('update_character', { id: MEERA, edit: { role: 'A night-shift nurse' } })
    spies.db.listCharacterRecords?.mockResolvedValue([character(MEERA, 'MEERA', { role: 'A night-shift nurse' })])
    await undoRunWith(gate(), RUN)
    expect(save).toHaveBeenLastCalledWith(GATE, MEERA, { role: 'A nurse' })
  })

  it('proposes the old value back, overwriting nothing, when the writer changed the field since', async () => {
    const save = action('character.saveProfile').mockResolvedValue({ status: 'saved' })
    await proposeAndApply('update_character', { id: MEERA, edit: { role: 'A night-shift nurse' } })
    spies.db.listCharacterRecords?.mockResolvedValue([character(MEERA, 'MEERA', { role: 'The ward sister' })])
    save.mockClear()
    const undo = await undoRunWith(gate(), RUN)
    expect(save).not.toHaveBeenCalled()
    expect(undo.status !== 'refused' && undo.proposal?.ops[0]?.args).toEqual({ id: MEERA, name: 'MEERA', edit: { role: 'A nurse' } })
  })

  it('rename_entity previews first, refuses a taken name, and always asks (tools.md: confirm)', async () => {
    const preview = action('character.previewRename').mockResolvedValue({ status: 'preview', to: 'MIRA', cues: 14, episodes: [{ ordinal: 1, cues: 9 }, { ordinal: 2, cues: 5 }], stays: [], taken: { by: MIRA, name: 'MIRA' } })
    expect((await propose('rename_entity', { entity: 'character', id: MEERA, name: 'MIRA' })).result).toEqual({ ok: false, message: "MIRA is already MIRA's name. Merge the two instead, or choose another name." })
    preview.mockResolvedValue({ status: 'preview', to: 'MEERA DEVI', cues: 14, episodes: [{ ordinal: 1, cues: 9 }, { ordinal: 2, cues: 5 }], stays: [], taken: null })
    const { proposed } = await propose('rename_entity', { entity: 'character', id: MEERA, name: 'Meera Devi' })
    expect(preview).toHaveBeenCalledWith(GATE, MEERA, 'Meera Devi')
    expect(proposed[0]?.mode).toBe('confirm')
    expect(proposed[0]?.description).toBe('Rename MEERA to MEERA DEVI - rewrites 14 cues in 2 episodes')
  })

  it("keeps the rename's restore payload as its undo record, and hands it to undoRename", async () => {
    action('character.previewRename').mockResolvedValue({ status: 'preview', to: 'MEERA DEVI', cues: 2, episodes: [{ ordinal: 1, cues: 2 }], stays: [], taken: null })
    const restores = [{ episode: 'ep_001', restores: [{ id: 'n1', text: 'MEERA' }] }]
    action('character.renameCharacter').mockResolvedValue({ status: 'renamed', cues: 2, episodes: 1, previousName: 'MEERA', name: 'MEERA DEVI', restores })
    const undoRename = action('character.undoRename').mockResolvedValue({ status: 'undone', cues: 2, skipped: 0 })
    const { outcome, id } = await proposeAndApply('rename_entity', { entity: 'character', id: MEERA, name: 'Meera Devi' }, true)
    expect(outcome.status).toBe('applied')
    expect(store.get(id)?.ops[0]?.undo).toEqual({ previousName: 'MEERA', restores })
    await undoRunWith(gate(), RUN)
    expect(undoRename).toHaveBeenCalledWith(GATE, MEERA, { previousName: 'MEERA', restores })
  })

  it('a location rename keeps its undo payload whole and snapshots every script first', async () => {
    action('location.previewRename').mockResolvedValue({ status: 'preview', to: 'ICU', headings: 3, episodes: [{ ordinal: 1, headings: 3 }], stays: [], taken: null })
    const undo = { locationId: WARD, previousName: 'WARD', name: 'ICU', restores: [] }
    action('location.renameLocation').mockResolvedValue({ status: 'renamed', headings: 3, episodes: 1, undo })
    const undoRename = action('location.undoRename').mockResolvedValue({ status: 'undone', headings: 3, skipped: 0 })
    spies.db.readDocumentByKind?.mockResolvedValue({ id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', kind: 'screenplay', episodeId: EPISODE.id, updatedAt: '' })
    spies.db.readDocumentById?.mockResolvedValue({ id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', kind: 'screenplay', episodeId: EPISODE.id, updatedAt: '' })
    spies.db.readScreenplayNodes?.mockResolvedValue({ ok: true, value: [] })
    await proposeAndApply('rename_entity', { entity: 'location', id: WARD, name: 'ICU' }, true)
    expect(spies.db.snapshotVersion?.mock.calls[0]?.[2]).toBe('before_agent_run')
    await undoRunWith(gate(), RUN)
    expect(undoRename).toHaveBeenCalledWith(GATE, undo)
  })

  it('merge_entities and delete_entity always ask, and undo leaves them, named', async () => {
    action('character.mergeCharacters').mockResolvedValue({ status: 'merged', into: MIRA })
    const { proposed } = await propose('merge_entities', { entity: 'character', loser: MEERA, winner: MIRA })
    expect(proposed[0]?.mode).toBe('confirm')
    const id = await stage(proposed)
    expect((await applyProposalWith(gate(), agentProposalId(id), { confirmed: false })).status).toBe('needs-confirmation')
    expect((await applyProposalWith(gate(), agentProposalId(id), { confirmed: true })).status).toBe('applied')
    const undo = await undoRunWith(gate(), RUN)
    expect(undo.status !== 'refused' && undo.skipped.map((skip) => skip.description)).toEqual(['Merge MEERA into MIRA'])
  })

  it('set_location_parent keeps the old parent and puts it back', async () => {
    const setParent = action('location.setParent').mockResolvedValue({ status: 'saved' })
    await proposeAndApply('set_location_parent', { id: WARD, parent: HOSPITAL })
    expect(setParent).toHaveBeenCalledWith(GATE, WARD, HOSPITAL)
    spies.db.listLocationRecords?.mockResolvedValue([{ id: WARD, name: 'WARD', parentId: HOSPITAL }, { id: HOSPITAL, name: 'HOSPITAL', parentId: null }])
    await undoRunWith(gate(), RUN)
    expect(setParent).toHaveBeenLastCalledWith(GATE, WARD, null)
  })

  it('resolve_queue_item binds a cue, and undo revokes exactly that decision', async () => {
    const resolve = action('character.resolveCue').mockResolvedValue({ status: 'resolved', pending: 0 })
    const revoke = action('character.revokeDecision').mockResolvedValue({ status: 'resolved', pending: 1 })
    await proposeAndApply('resolve_queue_item', { queue: 'cue', key: 'cue:MEERA (V.O.)', choice: { kind: 'character', id: MEERA } })
    expect(resolve).toHaveBeenCalledWith(GATE, 'cue:MEERA (V.O.)', { kind: 'character', id: MEERA })
    await undoRunWith(gate(), RUN)
    expect(revoke).toHaveBeenCalledWith(GATE, 'cue:MEERA (V.O.)', { kind: 'bound', id: MEERA })
  })

  it('save_relationship on a new pair is undone by removing it', async () => {
    action('character.saveRelationship').mockResolvedValue({ status: 'saved' })
    const remove = action('character.deleteRelationship').mockResolvedValue({ status: 'gone' })
    await proposeAndApply('save_relationship', { aId: MEERA, bId: MIRA, aIs: 'sister', bIs: 'sister', description: null })
    await undoRunWith(gate(), RUN)
    expect(remove).toHaveBeenCalledWith(GATE, MEERA, MIRA)
  })
})

describe('synopses and the timeline', () => {
  it('set_synopsis writes through the Scenes action with the scene`s episode, and undo restores the old line', async () => {
    const save = action('saveSynopsis').mockResolvedValue({ status: 'saved', synopsis: 'x' })
    const { id } = await proposeAndApply('set_synopsis', { sceneId: SCENE, synopsis: 'Meera comes back for the letter.' })
    expect(save).toHaveBeenCalledWith(GATE, { projectId: PROJECT, episode: 'ep_001', sceneNodeId: SCENE, synopsis: 'Meera comes back for the letter.' })
    expect(store.get(id)?.proposal.summary).toBe('Set the synopsis of E1 Sc 3')
    spies.db.readSceneAuthored?.mockResolvedValue({ synopsis: 'Meera comes back for the letter.', storyDay: 2, storyClock: null, flashback: false, threads: [] })
    await undoRunWith(gate(), RUN)
    expect(save).toHaveBeenLastCalledWith(GATE, { projectId: PROJECT, episode: 'ep_001', sceneNodeId: SCENE, synopsis: 'Meera returns.' })
  })

  it('set_story_time refuses a clock with no day, and undo puts the old time back', async () => {
    expect((await propose('set_story_time', { sceneId: SCENE, day: null, clock: '06:00', flashback: false })).result).toEqual({ ok: false, message: 'A clock needs a day.' })
    const save = action('saveStoryTime').mockResolvedValue({ status: 'saved' })
    await proposeAndApply('set_story_time', { sceneId: SCENE, day: 3, clock: '06:00' })
    expect(save).toHaveBeenCalledWith(GATE, SCENE, { day: 3, clock: '06:00', flashback: false })
    spies.db.readSceneAuthored?.mockResolvedValue({ synopsis: null, storyDay: 3, storyClock: '06:00', flashback: false, threads: [] })
    await undoRunWith(gate(), RUN)
    expect(save).toHaveBeenLastCalledWith(GATE, SCENE, { day: 2, clock: null, flashback: false })
  })

  it('place_scenes keeps the placements that landed, and undo unplaces exactly those', async () => {
    const landed = [{ sceneNodeId: SCENE, time: { day: 1, clock: null } }]
    action('placeScenes').mockResolvedValue({ status: 'placed', placements: landed })
    const unplace = action('unplaceScenes').mockResolvedValue({ status: 'unplaced', scenes: 1 })
    await proposeAndApply('place_scenes', { placements: [...landed, { sceneNodeId: nodeId('50000000-0000-4000-8000-000000000002'), time: { day: 1, clock: null } }] })
    await undoRunWith(gate(), RUN)
    expect(unplace).toHaveBeenCalledWith(GATE, landed)
  })

  it('manage_threads proposes a create, and confirms a delete (tools.md: propose · confirm)', async () => {
    const create = action('createThread').mockResolvedValue({ status: 'created', id: THREAD })
    const remove = action('deleteThread').mockResolvedValue({ status: 'deleted' })
    const { id } = await proposeAndApply('manage_threads', { action: 'create', name: 'The letter', colour: 'ochre' })
    expect(create).toHaveBeenCalledWith(GATE, { name: 'The letter', colour: 'ochre' }, store.get(id)?.ops[0]?.idempotencyKey)
    const { proposed } = await propose('manage_threads', { action: 'delete', id: THREAD })
    expect(proposed[0]?.mode).toBe('confirm')
    await undoRunWith(gate(), RUN)
    expect(remove).toHaveBeenCalledWith(GATE, THREAD)
  })

  it('mark_finding_deliberate marks an open finding by its key, and undo reopens it', async () => {
    const finding = { key: 'order:abc', kind: 'order', sceneId: SCENE, otherId: null, subject: null }
    spies.readContinuity.mockResolvedValue({ continuity: { buckets: { open: [finding], notes: [], deliberate: [] }, book: { labels: new Map() } }, scenes: [] })
    const mark = action('markDeliberate').mockResolvedValue({ status: 'saved' })
    const reopen = action('reopenFinding').mockResolvedValue({ status: 'saved' })
    const { id } = await proposeAndApply('mark_finding_deliberate', { action: 'mark', key: 'order:abc' })
    expect(store.get(id)?.proposal.summary).toBe('Mark as deliberate: Steps back from day 3')
    expect(mark).toHaveBeenCalledWith(GATE, { kind: 'order', key: 'order:abc', aRef: SCENE, bRef: null, subject: null })
    await undoRunWith(gate(), RUN)
    expect(reopen).toHaveBeenCalledWith(GATE, 'order:abc')
  })
})

describe('grouping a step into proposals', () => {
  const op = (tool: string, mode: ProposedOp['mode']): { key: string; op: ProposedOp } => ({ key: tool, op: { tool, args: {}, mode, description: tool } })

  it('puts every propose operation of a step in one proposal, and each confirm alone', () => {
    const groups = groupsOf([op('create_character', 'propose'), op('rename_entity', 'confirm'), op('update_character', 'propose'), op('delete_entity', 'confirm')])
    expect(groups.map((group) => group.ops.map((entry) => entry.key))).toEqual([['create_character', 'update_character'], ['rename_entity'], ['delete_entity']])
  })
})
