// @vitest-environment node
import type { Episode, Project } from '@folio/contracts'
import { ScreenplayNodeSchema, agentProposalId, episodeId, episodeSlug, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import type { DocumentId, ScreenplayNode } from '@folio/script'
import { byAgent, characterId, documentId, makeScreenplayNode, nodeId, text, typed } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { RUN, store } from './fake-proposals'

/**
 * Script and outline operations - roadmap task 3.4, ADR 0003 **D10**, **D11**.
 *
 * The server half, with the database and the two saves mocked and the
 * proposal store in memory. Held here:
 *
 *   - **Preparing** an edit mints every new node's id, turns plain text into
 *     runs, refuses a mention of a record that does not exist and an operation
 *     that cannot apply to the stored list, and takes the stored list's digest
 *     as the base.
 *   - **Path B** (nobody has it open) applies with the pure core and saves with
 *     `saveScript`, carrying the base digest as `expectedDigest`; what it
 *     writes carries the run (D11); the undo record is the snapshot and the
 *     digest the edit left.
 *   - **A stale conflict** - the save answers `stale`, or the document moved
 *     before apply - makes the proposal `stale` and writes nothing.
 *   - **Path A** (the writer has it open) saves nothing: the edit comes back
 *     for the editor, and the editor's report settles the proposal.
 *   - **Undo** writes the snapshot back when the document is as the agent
 *     left it, and proposes only the agent's changes back when it is not.
 *
 * The editor half - the operations applied inside a real Tiptap editor - is
 * `agent-editor-apply.test.ts`, which needs jsdom.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  saveScript: vi.fn(),
  saveOutline: vi.fn(),
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const { repository } = await import('./fake-proposals')
  const names = [
    'readDocumentById',
    'readDocumentByKind',
    'readScreenplayNodes',
    'readOutlineNodes',
    'readMentionLabels',
    'mintNodeIds',
    'readEpisode',
    'listEpisodes',
    'readVersionSnapshot',
    'snapshotVersion',
    'logAgentActivity',
  ]
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...repository, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})
vi.mock('../lib/script/actions', () => ({ saveScript: (...args: readonly unknown[]) => spies.saveScript(...args) }))
vi.mock('../lib/outline/actions', () => ({ saveOutline: (...args: readonly unknown[]) => spies.saveOutline(...args) }))
vi.mock('../lib/script/server', async (actual) => ({ ...(await actual<Record<string, unknown>>()), rederiveProject: () => Promise.resolve({ ok: true, derivation: null }) }))

const { prepareScriptEdit, scriptEditExecutor, describeEdit } = await import('../lib/agent/document-ops')
const { applyProposalWith, finishEditorApplyWith, undoRunWith } = await import('../lib/agent/apply')
const { registerExecutors } = await import('../lib/agent/executors')
const { nodeDigest } = await import('../lib/script/server')
const { repository } = await import('./fake-proposals')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const EPISODE: Episode = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const DOCUMENT: DocumentId = documentId('9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d')
const MEERA = characterId('5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c')
const VERSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const id = (n: number) => nodeId(`00000000-0000-4000-9000-${String(n).padStart(12, '0')}`)
const line = (n: number, type: ScreenplayNode['type'], words: string): ScreenplayNode => makeScreenplayNode(type, { id: id(n), provenance: typed(), content: [text(words)], modifiers: [] })

const SCRIPT: readonly ScreenplayNode[] = [line(1, 'scene', 'INT. WARD - NIGHT'), line(2, 'action', 'The ward is quiet.'), line(3, 'character', 'MEERA'), line(4, 'dialogue', 'You came back.')]

const gate = {
  actor: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b' as never,
  scope: {} as ProjectScope<'transaction'>,
  project: { id: PROJECT, format: 'hollywood', projectType: 'film' } as Project,
  episode: EPISODE,
  role: 'writer' as const,
}

/** The stored script, as the mocked database holds it. */
let stored: readonly ScreenplayNode[] = SCRIPT

beforeAll(() => {
  registerExecutors([scriptEditExecutor])
})

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  stored = SCRIPT
  spies.db.readDocumentByKind?.mockResolvedValue({ id: DOCUMENT, kind: 'screenplay', episodeId: EPISODE.id, updatedAt: '2026-09-23T09:00:00.000Z' })
  spies.db.readDocumentById?.mockResolvedValue({ id: DOCUMENT, kind: 'screenplay', episodeId: EPISODE.id, updatedAt: '2026-09-23T09:00:00.000Z' })
  spies.db.readScreenplayNodes?.mockImplementation(() => Promise.resolve({ ok: true, value: stored.map((node, index) => ({ node, orderKey: `a${String(index)}` })) }))
  spies.db.readMentionLabels?.mockResolvedValue([{ entity: 'character', id: MEERA, label: 'MEERA' }])
  spies.db.mintNodeIds?.mockImplementation((_scope, count) => Promise.resolve(Array.from({ length: Number(count) }, (_, index) => id(100 + index))))
  spies.db.readEpisode?.mockResolvedValue(EPISODE)
  spies.db.listEpisodes?.mockResolvedValue([EPISODE])
  spies.db.snapshotVersion?.mockResolvedValue({ id: VERSION })
  spies.db.readVersionSnapshot?.mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(SCRIPT))))
  spies.db.logAgentActivity?.mockResolvedValue(undefined)
  spies.saveScript.mockImplementation((raw: unknown) => {
    const input = raw as { upserts: ScreenplayNode[]; order: string[] | null; retirements: { nodeId: string }[] }
    // Lay the delta over the stored list, as the real save does.
    const held = new Map(stored.map((node) => [node.id as string, node]))
    const upserts = new Map(input.upserts.map((node) => [node.id as string, node]))
    const retired = new Set(input.retirements.map((entry) => entry.nodeId))
    stored = input.order === null ? stored.map((node) => upserts.get(node.id) ?? node) : input.order.map((entry) => upserts.get(entry) ?? held.get(entry)).filter((node): node is ScreenplayNode => node !== undefined && !retired.has(node.id))
    return Promise.resolve({ status: 'saved', updatedAt: '2026-09-23T09:05:00.000Z', conflict: null, measurement: null, stats: null, labels: [], snapshotTaken: false })
  })
})

const INSERT = [{ op: 'insert_after' as const, anchor: id(2), nodes: [{ type: 'action' as const, content: 'A monitor beeps.' }] }]

/** Prepare an edit and store it as a one-operation proposal, as the tool will. */
const propose = async (input = INSERT): Promise<string> => {
  const prepared = await prepareScriptEdit(gate, undefined, input)
  if (!prepared.ok) throw new Error(prepared.message)
  const made = await repository.createProposal(gate.scope, {
    runId: RUN,
    episodeId: EPISODE.id,
    summary: describeEdit('Script', prepared.args.ops, 'line'),
    base: { documents: [prepared.base] },
    needsConfirmation: false,
    creditCost: null,
    ops: [{ tool: 'propose_script_edit', args: prepared.args, mode: 'propose', idempotencyKey: `toolu_${String(Math.random())}` }],
  })
  return made.proposal.id
}

describe('preparing an edit', () => {
  it('mints every new id, turns plain text into runs, and bases the proposal on the stored digest', async () => {
    const prepared = await prepareScriptEdit(gate, undefined, INSERT)
    if (!prepared.ok) throw new Error(prepared.message)
    expect(prepared.args.ops[0]).toEqual({ op: 'insert_after', anchor: id(2), nodes: [{ id: id(100), type: 'action', content: [text('A monitor beeps.')], modifiers: [] }] })
    expect(prepared.base).toEqual({ documentId: DOCUMENT, kind: 'screenplay', episodeId: EPISODE.id, digest: nodeDigest(SCRIPT) })
    expect(describeEdit('Script', prepared.args.ops, 'line')).toBe('Script: add 1 line')
  })

  it('refuses an operation that cannot apply to the stored list, saying which', async () => {
    const prepared = await prepareScriptEdit(gate, undefined, [{ op: 'delete', ids: [id(2)] }, { op: 'replace_content', id: id(2), content: 'gone' }])
    expect(prepared).toEqual({ ok: false, message: `Operation 2: there is no node ${id(2)} in the document.` })
  })

  it('refuses a mention of a record that does not exist - never an invented id', async () => {
    const ghost = '11111111-2222-4333-8444-555555555555'
    const prepared = await prepareScriptEdit(gate, undefined, [
      { op: 'insert_after', anchor: id(2), nodes: [{ type: 'action', content: [{ kind: 'mention', target: { entity: 'character', id: ghost } }] }] },
    ])
    expect(prepared.ok ? null : prepared.message).toContain(`There is no character ${ghost}`)
    const known = await prepareScriptEdit(gate, undefined, [
      { op: 'insert_after', anchor: id(2), nodes: [{ type: 'action', content: [{ kind: 'mention', target: { entity: 'character', id: MEERA } }, { kind: 'text', text: ' sits.' }] }] },
    ])
    expect(known.ok).toBe(true)
  })

  it('checks a second call on top of the first in the same step', async () => {
    const first = await prepareScriptEdit(gate, undefined, [{ op: 'delete', ids: [id(4)] }])
    if (!first.ok) throw new Error(first.message)
    const second = await prepareScriptEdit(gate, undefined, [{ op: 'move', id: id(4), after: 'start' }], first.args.ops)
    expect(second.ok).toBe(false)
  })

  it('refuses an episode with no script yet', async () => {
    spies.db.readDocumentByKind?.mockResolvedValue(null)
    const prepared = await prepareScriptEdit(gate, undefined, INSERT)
    expect(prepared.ok ? null : prepared.message).toBe('This episode has no script yet. The writer starts it from the Script page.')
  })

  it('the save schema already carries provenance - an agent-written node reads (task 3.4)', () => {
    const written = makeScreenplayNode('action', { id: id(9), provenance: byAgent(RUN), content: [text('x')], modifiers: [] })
    expect(ScreenplayNodeSchema.parse(written).provenance).toEqual({ source: 'agent', runId: RUN })
  })
})

describe('path B - nobody has it open', () => {
  it('saves with the compare-and-swap, stamps what it wrote with the run, and records the undo', async () => {
    const proposal = await propose()
    const outcome = await applyProposalWith(gate, agentProposalId(proposal), { confirmed: false })
    expect(outcome.status).toBe('applied')
    const input = spies.saveScript.mock.calls[0]?.[0] as { expectedDigest: string; upserts: ScreenplayNode[]; order: string[]; episode: string; snapshot: boolean }
    expect(input.expectedDigest).toBe(nodeDigest(SCRIPT))
    expect(input.episode).toBe('ep_001')
    expect(input.upserts).toEqual([makeScreenplayNode('action', { id: id(100), provenance: byAgent(RUN), content: [text('A monitor beeps.')], modifiers: [] })])
    expect(input.order).toEqual([id(1), id(2), id(100), id(3), id(4)])
    expect(spies.db.snapshotVersion?.mock.calls[0]?.slice(1)).toEqual([DOCUMENT, 'before_agent_run', SCRIPT, 4, RUN])
    expect(store.get(proposal)?.ops[0]?.undo).toEqual({ documentId: DOCUMENT, versionId: VERSION, afterDigest: nodeDigest(stored) })
  })

  it('is stale, and writes nothing, when the save finds the script moved', async () => {
    const proposal = await propose()
    spies.saveScript.mockResolvedValue({ status: 'stale', conflict: { expected: 'a', found: 'b' } })
    const outcome = await applyProposalWith(gate, agentProposalId(proposal), { confirmed: false })
    expect(outcome.status).toBe('stale')
    expect(store.get(proposal)?.ops[0]?.status).toBe('failed')
  })

  it('is stale before any save when the writer changed the script since the proposal', async () => {
    const proposal = await propose()
    stored = [...SCRIPT, line(5, 'action', 'Typed by the writer.')]
    const outcome = await applyProposalWith(gate, agentProposalId(proposal), { confirmed: false })
    expect(outcome.status).toBe('stale')
    expect(spies.saveScript).not.toHaveBeenCalled()
  })
})

describe('path A - the writer has it open', () => {
  it('hands the edit to the editor instead of saving, then settles on its report', async () => {
    const proposal = await propose()
    const outcome = await applyProposalWith(gate, agentProposalId(proposal), { confirmed: false, editorDocuments: new Set([DOCUMENT]) })
    expect(outcome.status).toBe('editor')
    expect(spies.saveScript).not.toHaveBeenCalled()
    if (outcome.status !== 'editor') return
    expect(outcome.edits).toHaveLength(1)
    expect(outcome.edits[0]?.documentId).toBe(DOCUMENT)
    expect(outcome.edits[0]?.runId).toBe(RUN)
    expect(store.get(proposal)?.proposal.status).toBe('pending')

    const done = await finishEditorApplyWith(gate, agentProposalId(proposal), [{ opId: outcome.edits[0]?.opId ?? '', ok: true }])
    expect(done.status).toBe('applied')
    expect(store.get(proposal)?.ops[0]?.status).toBe('applied')
    expect((spies.db.logAgentActivity?.mock.calls[0]?.[1] as { verb: string }).verb).toBe('agent:propose_script_edit')
  })

  it('is stale when the editor finds the operations no longer apply to what is on screen', async () => {
    const proposal = await propose()
    const outcome = await applyProposalWith(gate, agentProposalId(proposal), { confirmed: false, editorDocuments: new Set([DOCUMENT]) })
    if (outcome.status !== 'editor') throw new Error('expected the editor path')
    const done = await finishEditorApplyWith(gate, agentProposalId(proposal), [{ opId: outcome.edits[0]?.opId ?? '', ok: false, stale: true, message: 'The script changed since this was proposed.' }])
    expect(done.status).toBe('stale')
  })
})

describe('undo', () => {
  it('writes the snapshot back when the script is as the agent left it', async () => {
    const proposal = await propose()
    await applyProposalWith(gate, agentProposalId(proposal), { confirmed: false })
    spies.saveScript.mockClear()
    const outcome = await undoRunWith(gate, RUN)
    expect(outcome.status).toBe('undone')
    expect(stored).toEqual(SCRIPT)
    const input = spies.saveScript.mock.calls[0]?.[0] as { expectedDigest: string; retirements: { nodeId: string }[] }
    expect(input.retirements).toEqual([{ nodeId: id(100), mergedInto: null }])
  })

  it('proposes only the agent’s changes back when the writer typed since, and overwrites nothing', async () => {
    const proposal = await propose()
    await applyProposalWith(gate, agentProposalId(proposal), { confirmed: false })
    stored = [...stored, line(5, 'action', 'Typed by the writer.')]
    spies.saveScript.mockClear()
    const outcome = await undoRunWith(gate, RUN)
    if (outcome.status === 'refused') throw new Error(outcome.message)
    expect(spies.saveScript).not.toHaveBeenCalled()
    expect(outcome.proposal?.ops[0]?.tool).toBe('propose_script_edit')
    expect((outcome.proposal?.ops[0]?.args as { ops: unknown[] }).ops).toEqual([{ op: 'delete', ids: [id(100)] }])
    expect(outcome.proposal?.proposal.base.documents[0]?.digest).toBe(nodeDigest(stored))
  })
})
