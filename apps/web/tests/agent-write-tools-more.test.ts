// @vitest-environment node
import type { AgentEvent, Episode, Project } from '@folio/contracts'
import { agentProposalId, episodeId, episodeSlug, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { documentId, makeScreenplayNode, nodeId, text, typed } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProposedOp, Tool, Toolset } from '../lib/agent/registry'
import { RUN, store } from './fake-proposals'

/**
 * The remaining write tools - roadmap task 3.6: script and outline edits,
 * the title page, comments, format and pagination, the Storyboard, Production
 * (non-paid), episodes, `undo_run`, and the launcher's `start_story_project`
 * with the adapter over `createProject` it wraps.
 *
 * The wrapped actions are mocked, the proposals are the in-memory store. Held
 * here, per family: what a call proposes and in which mode, what applying
 * calls, what cannot be undone, and the two `direct` tools landing at once
 * through the real sink. `start_story_project` never creates anything itself.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  actions: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
}))

const mocked = (names: readonly string[], prefix = '') => Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.actions[`${prefix}${name}`]?.(...args)]))

vi.mock('../lib/script/actions', () => mocked(['openThreadOnNode', 'replyThread', 'resolveThread', 'saveTitlePage', 'setFormat', 'setPagination', 'saveScript']))
vi.mock('../lib/outline/actions', () => mocked(['saveOutline']))
vi.mock('../lib/storyboard/actions', () => mocked(['acceptShots', 'addShot', 'discardShots', 'placeShot', 'proposeShotsForScene', 'saveShot'], 'storyboard.'))
vi.mock('../lib/production/actions', () => mocked(['addReel', 'addShot', 'bulkPatchShots', 'deleteReel', 'deleteShot', 'moveShot', 'patchReel', 'patchShot', 'retimeShot', 'saveSettings'], 'production.'))
vi.mock('../lib/production/generate', () => mocked(['aiShotlist', 'cancelGeneration']))
vi.mock('../lib/workspace/actions', () => mocked(['createEpisode', 'renameEpisode']))
vi.mock('../lib/auth/session', async (actual) => ({ ...(await actual<Record<string, unknown>>()), requireUser: (...args: readonly unknown[]) => spies.requireUser(...args) }))
vi.mock('next/cache', () => ({ revalidatePath: (...args: readonly unknown[]) => spies.revalidatePath(...args) }))
vi.mock('../lib/script/server', async (actual) => ({ ...(await actual<Record<string, unknown>>()), rederiveProject: () => Promise.resolve({ ok: true, derivation: null }) }))
vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const { repository } = await import('./fake-proposals')
  const names = [
    'listEpisodes',
    'listSceneIndex',
    'readDocumentByKind',
    'readDocumentById',
    'readScreenplayNodes',
    'readMentionLabels',
    'mintNodeIds',
    'readTitlePage',
    'readProject',
    'readShot',
    'listSceneShots',
    'readReel',
    'readReelIdOfShot',
    'readEpisodeSettings',
    'readArtStyleByKey',
    'readAgentRun',
    'snapshotVersion',
    'logAgentActivity',
    'createProjectFor',
    'transactionDatabase',
  ]
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...repository, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})

const { SCRIPT_WRITE_TOOLS, DOCUMENT_TOOLS } = await import('../lib/agent/tools/writes-script')
const { STORYBOARD_WRITE_TOOLS } = await import('../lib/agent/tools/writes-storyboard')
const { PRODUCTION_WRITE_TOOLS } = await import('../lib/agent/tools/writes-production')
const { EPISODE_WRITE_TOOLS } = await import('../lib/agent/tools/writes-episodes')
const { LAUNCHER_TOOLS } = await import('../lib/agent/tools/launcher')
const { DOCUMENT_EXECUTORS } = await import('../lib/agent/document-ops')
const { registerExecutors, executorFor } = await import('../lib/agent/executors')
const { executorsOf, toolsOf } = await import('../lib/agent/write-tool')
const { runTool } = await import('../lib/agent/registry')
const { applyProposalWith, undoRunWith } = await import('../lib/agent/apply')
const { proposalSink } = await import('../lib/agent/proposer')
const { startStoryProject } = await import('../lib/projects/actions')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const DOCUMENT = documentId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d')
const SCENE = nodeId('50000000-0000-4000-8000-000000000001')
const SHOT = '70000000-0000-4000-8000-000000000001'
const REEL = '80000000-0000-4000-8000-000000000001'
const OTHER_RUN = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c99'
const id = (n: number) => nodeId(`00000000-0000-4000-9000-${String(n).padStart(12, '0')}`)

const gate = (role: 'reader' | 'writer' | 'owner' = 'writer', projectType: 'film' | 'series' = 'series') => ({
  actor: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b' as never,
  scope: {} as ProjectScope<'transaction'>,
  project: { id: PROJECT, format: 'hollywood', projectType, pageMode: 'paged', liveRepaginate: false } as Project,
  episode: EPISODE,
  role,
})

const TOOLS: readonly Tool[] = [
  ...DOCUMENT_TOOLS,
  ...toolsOf(SCRIPT_WRITE_TOOLS),
  ...toolsOf(STORYBOARD_WRITE_TOOLS),
  ...toolsOf(PRODUCTION_WRITE_TOOLS),
  ...toolsOf(EPISODE_WRITE_TOOLS),
  ...LAUNCHER_TOOLS,
]

beforeAll(() => {
  registerExecutors([
    ...DOCUMENT_EXECUTORS,
    ...executorsOf(SCRIPT_WRITE_TOOLS),
    ...executorsOf(STORYBOARD_WRITE_TOOLS),
    ...executorsOf(PRODUCTION_WRITE_TOOLS),
    ...executorsOf(EPISODE_WRITE_TOOLS),
  ])
})

const SCRIPT = [
  makeScreenplayNode('scene', { id: id(1), provenance: typed(), content: [text('INT. WARD - NIGHT')], modifiers: [] }),
  makeScreenplayNode('action', { id: id(2), provenance: typed(), content: [text('Quiet.')], modifiers: [] }),
]

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  for (const key of Object.keys(spies.actions)) delete spies.actions[key]
  spies.db.listEpisodes?.mockResolvedValue([EPISODE])
  spies.db.listSceneIndex?.mockResolvedValue([{ sceneNodeId: SCENE, episodeOrdinal: 1, ordinalInEpisode: 3, number: 3 }])
  spies.db.readDocumentByKind?.mockResolvedValue({ id: DOCUMENT, kind: 'screenplay', episodeId: EPISODE.id, updatedAt: '' })
  spies.db.readDocumentById?.mockResolvedValue({ id: DOCUMENT, kind: 'screenplay', episodeId: EPISODE.id, updatedAt: '' })
  spies.db.readScreenplayNodes?.mockResolvedValue({ ok: true, value: SCRIPT.map((node) => ({ node, orderKey: 'a' })) })
  spies.db.readMentionLabels?.mockResolvedValue([])
  let minted = 100
  spies.db.mintNodeIds?.mockImplementation((_scope, count) => Promise.resolve(Array.from({ length: Number(count) }, () => id((minted += 1)))))
  spies.db.snapshotVersion?.mockResolvedValue({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
  spies.db.logAgentActivity?.mockResolvedValue(undefined)
})

const action = (name: string) => {
  const spy = vi.fn()
  spies.actions[name] = spy
  return spy
}

/** Run a tool with a queue that folds by merge key, as the loop's does. */
const propose = async (name: string, input: unknown, options: { readonly role?: 'reader' | 'writer' | 'owner'; readonly queue?: ProposedOp[]; readonly projectType?: 'film' | 'series' } = {}) => {
  const queue = options.queue ?? []
  const events: AgentEvent[] = []
  const result = await runTool(
    name,
    input,
    {
      gate: gate(options.role ?? 'writer', options.projectType),
      runId: RUN,
      idempotencyKey: `toolu_${name}`,
      emit: (event) => events.push(event),
      loaded: new Set<Toolset>(),
      proposals: {
        propose: (op) => {
          const at = op.mergeKey === undefined ? -1 : queue.findIndex((entry) => entry.mergeKey === op.mergeKey)
          if (at === -1) queue.push(op)
          else queue[at] = op
        },
        earlier: (key) => queue.find((entry) => entry.mergeKey === key)?.args,
        applyNow: (op) => proposalSink(gate(), RUN).applyNow(op, `toolu_${name}`),
      },
    },
    TOOLS,
  )
  return { result, queue, events }
}

const stage = async (ops: readonly ProposedOp[]): Promise<string> => {
  const made = await proposalSink(gate(), RUN).create([{ ops: ops.map((op, index) => ({ key: `toolu_${String(Math.random())}_${String(index)}`, op })) }])
  return made[0]?.proposalId ?? ''
}

describe('script and outline edits', () => {
  it('folds two calls on one script in a step into one operation, checked on top of each other', async () => {
    const queue: ProposedOp[] = []
    await propose('propose_script_edit', { ops: [{ op: 'insert_after', anchor: id(2), nodes: [{ type: 'action', content: 'A monitor beeps.' }] }] }, { queue })
    const second = await propose('propose_script_edit', { ops: [{ op: 'replace_content', id: id(101), content: 'A monitor beeps twice.' }] }, { queue })
    expect(second.result.ok).toBe(true)
    expect(queue).toHaveLength(1)
    expect((queue[0]?.args as { ops: unknown[] }).ops).toHaveLength(2)
    expect(queue[0]?.description).toBe('Script, episode 1: add 1 line, rewrite 1')
    expect(queue[0]?.base?.documentId).toBe(DOCUMENT)
  })

  it('tells the model the ids it minted, so the next edit can anchor on a new line', async () => {
    const { result } = await propose('propose_script_edit', { ops: [{ op: 'insert_after', anchor: 'start', nodes: [{ type: 'transition', content: 'FADE IN:' }] }] })
    expect(result.ok && (result.content as { newNodeIds: string[] }).newNodeIds).toEqual([id(101)])
  })
})

describe('the title page, comments, format and pagination', () => {
  it('merges a title page edit over the current cover, and keeps the old cover to put back', async () => {
    spies.db.readTitlePage?.mockResolvedValue({ title: 'Harbour Lights', credit: 'written by', author: 'A. Writer', source: null, draftDate: null, contact: null, copyright: null, notes: null })
    const save = action('saveTitlePage').mockResolvedValue({ status: 'saved' })
    const { queue } = await propose('save_title_page', { fields: { draftDate: '23 September 2026' } })
    await applyProposalWith(gate(), agentProposalId(await stage(queue)), { confirmed: false })
    expect(save).toHaveBeenCalledWith(PROJECT, 'ep_001', expect.objectContaining({ title: 'Harbour Lights', author: 'A. Writer', draftDate: '23 September 2026' }))
  })

  it('lets a reader propose and apply a comment - D2 gives comment threads to a reader - and says it cannot be undone', async () => {
    const open = action('openThreadOnNode').mockResolvedValue({ status: 'ok', thread: { id: 'thread-1' } })
    const { queue, result } = await propose('comment_on_node', { nodeId: id(2), body: 'Is it too quiet?' }, { role: 'reader' })
    expect(result.ok).toBe(true)
    const proposal = await stage(queue)
    expect((await applyProposalWith(gate('reader'), agentProposalId(proposal), { confirmed: false })).status).toBe('applied')
    expect(open).toHaveBeenCalledWith(PROJECT, 'ep_001', id(2), 'Is it too quiet?', 'script_node')
    expect(executorFor('comment_on_node')?.reversible(queue[0]?.args)).toBe(false)
  })

  it('refuses a reader the script edit that sits beside the comments', async () => {
    expect((await propose('propose_script_edit', { ops: [{ op: 'delete', ids: [id(2)] }] }, { role: 'reader' })).result).toEqual({ ok: false, message: "Your role on this project doesn't allow that." })
  })

  it('always asks before a format change, and puts the old format back on undo', async () => {
    spies.db.readProject?.mockResolvedValue({ format: 'hollywood' })
    const setFormat = action('setFormat').mockResolvedValue({ status: 'done' })
    const { queue } = await propose('set_format', { format: 'asian' })
    expect(queue[0]?.mode).toBe('confirm')
    const proposal = await stage(queue)
    expect((await applyProposalWith(gate(), agentProposalId(proposal), { confirmed: false })).status).toBe('needs-confirmation')
    await applyProposalWith(gate(), agentProposalId(proposal), { confirmed: true })
    await undoRunWith(gate(), RUN)
    expect(setFormat.mock.calls.map((call) => call[2])).toEqual(['asian', 'hollywood'])
  })
})

describe('the Storyboard', () => {
  it('drafts shots directly - they land as proposed rows - and undo discards only those still waiting', async () => {
    action('storyboard.proposeShotsForScene').mockResolvedValue({ status: 'saved', accepted: 0, shots: [{ id: SHOT, state: 'proposed' }, { id: '70000000-0000-4000-8000-000000000002', state: 'proposed' }] })
    const discard = action('storyboard.discardShots').mockResolvedValue({ status: 'saved', shots: [], accepted: 0 })
    const { result } = await propose('propose_storyboard_shots', { sceneId: SCENE })
    expect(result).toMatchObject({ ok: true, summary: 'Draft shots for E1 Sc 3 on the board' })
    expect([...store.values()][0]?.proposal.status).toBe('applied')
    spies.db.listSceneShots?.mockResolvedValue([{ id: SHOT, state: 'proposed' }, { id: '70000000-0000-4000-8000-000000000002', state: 'accepted' }])
    await undoRunWith(gate(), RUN)
    expect(discard).toHaveBeenCalledWith(PROJECT, 'ep_001', { sceneNodeId: SCENE, shotIds: [SHOT] })
  })

  it('marks accepting shots as something that cannot be undone', async () => {
    const { queue } = await propose('accept_or_discard_shots', { action: 'accept', sceneId: SCENE, shotIds: [SHOT] })
    expect(executorFor('accept_or_discard_shots')?.reversible(queue[0]?.args)).toBe(false)
  })
})

describe('Production', () => {
  it('confirms a reel delete (propose · confirm) and cannot undo it', async () => {
    spies.db.readReel?.mockResolvedValue({ id: REEL, name: 'Reel 2', clipLengthS: 15, shots: [] })
    const { queue } = await propose('manage_reels', { action: 'delete', reelId: REEL })
    expect(queue[0]?.mode).toBe('confirm')
    expect(executorFor('manage_reels')?.reversible(queue[0]?.args)).toBe(false)
  })

  it('runs the AI shotlist directly at no cost, and accepts the rule-based fallback when no model key is set', async () => {
    spies.db.readReel?.mockResolvedValue({ id: REEL, name: 'Reel 2', clipLengthS: 15, shots: [] })
    const shotlist = action('aiShotlist').mockResolvedValue({ status: 'disconnected', message: 'No model key: rule-based shots proposed.' })
    const { result } = await propose('ai_shotlist', { reelId: REEL })
    expect(result).toMatchObject({ ok: true })
    expect(shotlist).toHaveBeenCalledWith(PROJECT, 'ep_001', REEL)
  })

  it('patches a shot and puts the old values back', async () => {
    spies.db.readReelIdOfShot?.mockResolvedValue(REEL)
    spies.db.readReel?.mockResolvedValue({ id: REEL, name: 'Reel 2', clipLengthS: 15, shots: [{ id: SHOT, priority: 'low', notes: null }] })
    const patch = action('production.patchShot').mockResolvedValue({ status: 'saved', shot: {} })
    const { queue } = await propose('manage_shots', { action: 'patch', shotId: SHOT, patch: { priority: 'high', notes: 'Rain rig' } })
    await applyProposalWith(gate(), agentProposalId(await stage(queue)), { confirmed: false })
    await undoRunWith(gate(), RUN)
    expect(patch.mock.calls.map((call) => call[3])).toEqual([{ priority: 'high', notes: 'Rain rig' }, { priority: 'low', notes: null }])
  })
})

describe('episodes and undo_run', () => {
  it('refuses a new episode on a film, and says a created episode cannot be undone', async () => {
    expect((await propose('create_episode', { title: 'Two' }, { projectType: 'film' })).result).toEqual({ ok: false, message: 'A film has one episode.' })
    const { queue } = await propose('create_episode', { title: 'Two' })
    expect(executorFor('create_episode')?.reversible(queue[0]?.args)).toBe(false)
  })

  it('undo_run always asks, and never undoes the run it is part of', async () => {
    expect((await propose('undo_run', { runId: RUN })).result).toEqual({ ok: false, message: 'This run cannot undo itself. Ask again after this turn.' })
    spies.db.readAgentRun?.mockResolvedValue({ id: OTHER_RUN, createdAt: '2026-09-23T08:15:00.000Z' })
    const { queue } = await propose('undo_run', { runId: OTHER_RUN })
    expect(queue[0]?.mode).toBe('confirm')
    expect(queue[0]?.description).toBe('Undo the run of 2026-09-23 08:15')
  })
})

describe('start_story_project and its adapter', () => {
  it('the tool only asks - it creates nothing, and a model cannot confirm for the writer', async () => {
    const { result, events } = await propose('start_story_project', { title: 'Tide Line', projectType: 'film', story: 'A lighthouse keeper...' })
    expect(result).toMatchObject({ ok: true, summary: 'Waiting for the writer to confirm' })
    expect(events.map((event) => event.type)).toEqual(['confirm_required'])
    expect(spies.db.createProjectFor).not.toHaveBeenCalled()
  })

  it('the adapter makes the project with createProject`s logic and hands it back instead of redirecting', async () => {
    spies.requireUser.mockResolvedValue({ id: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b' })
    spies.db.transactionDatabase?.mockResolvedValue({})
    spies.db.createProjectFor?.mockResolvedValue({ project: { id: PROJECT, title: 'Tide Line', projectType: 'film' }, episode: { slug: 'ep_001' } })
    const result = await startStoryProject({ title: 'Tide Line', projectType: 'film', format: 'hollywood', story: 'A lighthouse keeper...' })
    expect(result).toEqual({ status: 'created', projectId: PROJECT, title: 'Tide Line', href: `/app/project/${PROJECT}/script` })
    expect(spies.db.createProjectFor?.mock.calls[0]?.[2]).toEqual({ title: 'Tide Line', kind: 'screenwriting', projectType: 'film', format: 'hollywood', logline: null })
  })

  it('refuses an empty story before it makes anything', async () => {
    spies.requireUser.mockResolvedValue({ id: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b' })
    expect(await startStoryProject({ title: 'Tide Line', projectType: 'film', format: 'hollywood', story: '  ' })).toEqual({ status: 'error', message: 'Write or paste the story first.' })
    expect(spies.db.createProjectFor).not.toHaveBeenCalled()
  })
})
