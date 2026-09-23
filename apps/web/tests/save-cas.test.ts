// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Compare-and-swap on a save - roadmap task 1.6, ADR 0003 **D10**.
 *
 * `saveScript` replaces the whole node list and the last save wins. For two
 * people typing that is the ruling (AGENTS.md: no realtime, last-write-wins
 * with a banner), because both of them are looking at the document. For a
 * caller that is *not* looking at it - an agent whose operations were planned
 * against a list it read a minute ago - it means erasing whatever the writer
 * typed while it was thinking.
 *
 * So the save takes an optional `expectedDigest`, and the two properties worth
 * testing are the two halves of that sentence: with the field, a moved
 * document is refused and **nothing is written**; without it, the behaviour is
 * exactly what it was, conflict banner and all.
 */

const spies = vi.hoisted(() => ({
  openEpisodeWith: vi.fn(),
  commitNodePlan: vi.fn(),
  readLatestLockedPages: vi.fn(),
  snapshotVersion: vi.fn(),
  readNodeRows: vi.fn(),
  readDocumentById: vi.fn(),
  readMentionLabels: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@folio/db/env', () => ({ storageEnv: null, modelEnv: null, assistantEnv: null }))

vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  commitNodePlan: (...args: readonly unknown[]) => spies.commitNodePlan(...args),
  readLatestLockedPages: (...args: readonly unknown[]) => spies.readLatestLockedPages(...args),
  snapshotVersion: (...args: readonly unknown[]) => spies.snapshotVersion(...args),
  readNodeRows: (...args: readonly unknown[]) => spies.readNodeRows(...args),
  readDocumentById: (...args: readonly unknown[]) => spies.readDocumentById(...args),
  readMentionLabels: (...args: readonly unknown[]) => spies.readMentionLabels(...args),
}))

vi.mock('../lib/script/gate', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  openEpisodeWith: (...args: readonly unknown[]) => spies.openEpisodeWith(...args),
}))

vi.mock('../lib/script/server', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  deferAfterSave: vi.fn(),
}))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const DOCUMENT = '22222222-2222-4222-8222-222222222222'
const EPISODE_ID = '33333333-3333-4333-8333-333333333333'
const NODE = '44444444-4444-4444-8444-444444444444'
const STAMP = '2026-09-23T10:00:00.000Z'

/** One stored scene heading, in the row shape the repository returns. */
const storedRow = (text: string) => ({
  id: NODE,
  documentKind: 'screenplay',
  type: 'scene',
  orderKey: 'a0',
  content: [{ kind: 'text', text }],
  modifiers: [],
  provenanceSource: 'typed',
  provenanceRunId: null,
})

const savePayload = (extra: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  episode: 'ep_001',
  documentId: DOCUMENT,
  baseUpdatedAt: STAMP,
  upserts: [
    {
      id: NODE,
      type: 'scene',
      content: [{ kind: 'text', text: 'INT. A NEW ROOM - DAY' }],
      provenance: { source: 'typed' },
    },
  ],
  order: null,
  retirements: [],
  snapshot: false,
  derive: false,
  recordDigest: null,
  ...extra,
})

beforeAll(async () => {
  await import('../lib/script/actions')
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  const rows = [storedRow('INT. HARBOUR - NIGHT')]
  spies.openEpisodeWith.mockImplementation(async (_projectId, _episode, alongside) => ({
    actor: EPISODE_ID,
    scope: {},
    project: { id: PROJECT, format: 'hollywood', pageMode: 'paged' },
    episode: { id: EPISODE_ID, slug: 'ep_001', revisionColour: 'white' },
    role: 'writer',
    extra: await alongside({}),
  }))
  spies.readDocumentById.mockResolvedValue({ id: DOCUMENT, episodeId: EPISODE_ID, kind: 'screenplay', updatedAt: STAMP })
  spies.readNodeRows.mockResolvedValue(rows)
  spies.readMentionLabels.mockResolvedValue([])
  spies.readLatestLockedPages.mockResolvedValue([])
  spies.commitNodePlan.mockResolvedValue({ updatedAt: '2026-09-23T10:00:01.000Z' })
})

/** The digest of the list the repository is returning, computed the way the server does. */
const storedDigest = async (): Promise<string> => {
  const { nodeDigest } = await import('../lib/script/server')
  const { parseScreenplayRows } = await import('@folio/db')
  const stored = parseScreenplayRows(await spies.readNodeRows())
  if (!stored.ok) throw new Error('fixture rows did not parse')
  return nodeDigest(stored.value.map((entry: { node: unknown }) => entry.node))
}

describe('without the field, nothing changes', () => {
  it('writes, and reports the conflict rather than refusing it', async () => {
    const { saveScript } = await import('../lib/script/actions')
    // A stamp that disagrees is the existing last-write-wins case.
    const outcome = await saveScript(savePayload({ baseUpdatedAt: '2026-09-23T09:00:00.000Z' }))
    expect(outcome.status).toBe('saved')
    expect(spies.commitNodePlan).toHaveBeenCalledOnce()
    if (outcome.status === 'saved') {
      expect(outcome.conflict).toEqual({ expected: '2026-09-23T09:00:00.000Z', found: STAMP })
    }
  })
})

describe('with the field', () => {
  it('writes when the digest still describes the stored list', async () => {
    const { saveScript } = await import('../lib/script/actions')
    const outcome = await saveScript(savePayload({ expectedDigest: await storedDigest() }))
    expect(outcome.status).toBe('saved')
    expect(spies.commitNodePlan).toHaveBeenCalledOnce()
  })

  it('writes nothing when the stored list has moved', async () => {
    const { saveScript } = await import('../lib/script/actions')
    const outcome = await saveScript(savePayload({ expectedDigest: 'a digest of some other list' }))
    expect(outcome.status).toBe('stale')
    expect(spies.commitNodePlan).not.toHaveBeenCalled()
    expect(spies.snapshotVersion).not.toHaveBeenCalled()
  })

  it('names what it expected and what it found, so a caller can re-plan', async () => {
    const { saveScript } = await import('../lib/script/actions')
    const outcome = await saveScript(savePayload({ expectedDigest: 'stale' }))
    if (outcome.status !== 'stale') throw new Error('expected a stale result')
    expect(outcome.conflict.expected).toBe(STAMP)
    expect(outcome.conflict.found).toBe(STAMP)
  })

  it('is the same digest function that writes measurements.node_digest', async () => {
    // Two functions would be two answers to "has this list changed", which is
    // the only question the compare-and-swap asks.
    const { nodeDigest } = await import('../lib/script/server')
    const list = [{ id: NODE, type: 'action' }]
    expect(nodeDigest(list)).toBe(nodeDigest([...list]))
    expect(nodeDigest(list)).not.toBe(nodeDigest([{ id: NODE, type: 'character' }]))
  })
})
