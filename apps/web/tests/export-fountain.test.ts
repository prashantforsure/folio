// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fountain out - roadmap task 1.8(a).
 *
 * `serialiseFountain` has been a tested pure function since the Fountain pass
 * and nothing called it: the Script menu offered `.fdx` alone, and account
 * settings pointed writers at the Outline route's menu, where a *Markdown*
 * export of a different document lives. What is new is the action, so what is
 * tested here is the action: that it reads the episode's screenplay, that the
 * file it hands back is the serialiser's own output under a name taken from
 * the episode, and that it is a read - `ROLE.export`, writing nothing.
 */

const spies = vi.hoisted(() => ({
  openEpisode: vi.fn(),
  readDocumentByKind: vi.fn(),
  readScreenplayNodes: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@folio/db/env', () => ({ storageEnv: null, modelEnv: null, assistantEnv: null }))

vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  readDocumentByKind: (...args: readonly unknown[]) => spies.readDocumentByKind(...args),
  readScreenplayNodes: (...args: readonly unknown[]) => spies.readScreenplayNodes(...args),
}))

vi.mock('../lib/script/gate', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  openEpisode: (...args: readonly unknown[]) => spies.openEpisode(...args),
}))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const EPISODE_ID = '22222222-2222-4222-8222-222222222222'
const DOCUMENT = '33333333-3333-4333-8333-333333333333'

const node = (id: string, type: string, text: string) => ({
  node: { id, type, provenance: { source: 'typed' }, content: [{ kind: 'text', text }] },
  orderKey: id,
})

beforeAll(async () => {
  await import('../lib/script/actions')
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  spies.openEpisode.mockResolvedValue({
    actor: EPISODE_ID,
    scope: {},
    project: { id: PROJECT },
    episode: { id: EPISODE_ID, slug: 'ep_001', title: 'Harbour Lights' },
    role: 'reader',
  })
  spies.readDocumentByKind.mockResolvedValue({ id: DOCUMENT, episodeId: EPISODE_ID, kind: 'screenplay' })
  spies.readScreenplayNodes.mockResolvedValue({
    ok: true,
    value: [
      node('a1', 'scene', 'INT. HARBOUR - NIGHT'),
      node('a2', 'action', 'Rain on the water.'),
      node('a3', 'comment', 'ask the producer about this'),
    ],
  })
})

describe('exporting the script as Fountain', () => {
  it('writes the scene and the action, and leaves the note out', async () => {
    const { exportScriptFountain } = await import('../lib/script/actions')
    const outcome = await exportScriptFountain(PROJECT, 'ep_001')
    if (outcome.status !== 'exported') throw new Error(`expected an export, got ${outcome.status}`)
    expect(outcome.text).toContain('INT. HARBOUR - NIGHT')
    expect(outcome.text).toContain('Rain on the water.')
    // AGENTS.md, Export: "Comments never enter an export."
    expect(outcome.text).not.toContain('ask the producer')
    expect(outcome.omitted).toBe(1)
  })

  it('names the file after the episode', async () => {
    const { exportScriptFountain } = await import('../lib/script/actions')
    const outcome = await exportScriptFountain(PROJECT, 'ep_001')
    if (outcome.status !== 'exported') throw new Error('expected an export')
    expect(outcome.filename).toBe('Harbour-Lights.fountain')
  })

  it('is a read, so a reader may take one', async () => {
    const { exportScriptFountain } = await import('../lib/script/actions')
    await exportScriptFountain(PROJECT, 'ep_001')
    expect(spies.openEpisode).toHaveBeenCalledWith(PROJECT, 'ep_001', 'reader')
  })

  it('says so rather than exporting an empty file when there is no script', async () => {
    spies.readDocumentByKind.mockResolvedValue(null)
    const { exportScriptFountain } = await import('../lib/script/actions')
    expect(await exportScriptFountain(PROJECT, 'ep_001')).toEqual({
      status: 'error',
      message: 'There is no script to export yet.',
    })
  })

  it('round-trips: what it writes, the parser reads back as the same nodes', async () => {
    // The serialiser's own promise, checked through the action - this is why
    // `forced` is reported under its own name rather than as a loss.
    const { exportScriptFountain } = await import('../lib/script/actions')
    const { parseFountain } = await import('@folio/script')
    const outcome = await exportScriptFountain(PROJECT, 'ep_001')
    if (outcome.status !== 'exported') throw new Error('expected an export')
    const { nodeId } = await import('@folio/script')
    const freshIds = Array.from({ length: 32 }, (_, index) =>
      nodeId(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    )
    const parsed = parseFountain(outcome.text, { freshIds })
    if (!parsed.ok) throw new Error('the serialiser wrote something its own parser will not read')
    expect(parsed.value.nodes.map((node) => node.type)).toEqual(['scene', 'action'])
  })
})
