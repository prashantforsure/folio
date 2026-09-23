// @vitest-environment node
import type { Episode, Project } from '@folio/contracts'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A turn in a background run's own chat - roadmap task 4.4.
 *
 * While the run is queued, running or waiting for its starter, the chat's
 * transcript is the run's: an interactive turn there would write the same
 * transcript at once, so `ask()` refuses it with a `409` before a run row is
 * written. Once the run is over, the chat is an ordinary one again.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  openEpisodeWith: vi.fn(),
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['readChatRun', 'transactionDatabase', 'tokensTodayFor', 'readAgentAutonomy', 'createAgentRun', 'listMessages']
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})
vi.mock('../lib/assistant/client', async (actual) => ({ ...(await actual<Record<string, unknown>>()), assistantClient: () => ({ messages: { stream: vi.fn() } }) }))
vi.mock('../lib/script/gate', async (actual) => ({ ...(await actual<Record<string, unknown>>()), openEpisodeWith: (...args: readonly unknown[]) => spies.openEpisodeWith(...args) }))
vi.mock('../lib/agent/rate-limit', () => ({ checkRateLimit: () => Promise.resolve(null) }))
vi.mock('../lib/assistant/turn-context', () => ({ turnSystem: () => Promise.resolve([{ type: 'text', text: 'The script.' }]) }))

const { ask, RUN_CHAT_BUSY } = await import('../lib/assistant/server')

const PROJECT = '6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10'
const EPISODE = '1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'
const CHAT = '0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21'

const db = (name: string): Mock<(...args: readonly unknown[]) => unknown> => {
  const spy = spies.db[name]
  if (spy === undefined) throw new Error(`no spy ${name}`)
  return spy
}

const request = { projectId: PROJECT, episode: 'ep_001', chatId: CHAT, message: 'And the second act?', scope: 'episode', route: 'script' }

beforeEach(() => {
  vi.clearAllMocks()
  spies.openEpisodeWith.mockResolvedValue({
    actor: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b',
    scope: { projectId: PROJECT },
    project: { id: PROJECT, title: 'Harbour Lights' } as Project,
    episode: { id: EPISODE, slug: 'ep_001', title: 'Pilot' } as Episode,
    role: 'writer',
    extra: { chat: { id: CHAT, episodeId: EPISODE }, labels: [], records: [] },
  })
  db('transactionDatabase').mockResolvedValue({})
  db('tokensTodayFor').mockResolvedValue(0)
  db('readAgentAutonomy').mockResolvedValue('review')
  db('listMessages').mockResolvedValue([])
  db('createAgentRun').mockRejectedValue(new Error('not in this test'))
})

describe('ask() in a background run`s chat', () => {
  it.each(['queued', 'running', 'waiting_for_user'])('refuses a turn with a 409 while the run is %s, before a run row is written', async (status) => {
    db('readChatRun').mockResolvedValue({ id: 'run-1', status })
    expect(await ask(request, new AbortController().signal)).toEqual({ status: 'refused', code: 409, message: RUN_CHAT_BUSY })
    expect(db('createAgentRun')).not.toHaveBeenCalled()
  })

  it('takes the turn once the run is over, as in any chat', async () => {
    db('readChatRun').mockResolvedValue({ id: 'run-1', status: 'succeeded' })
    const outcome = await ask(request, new AbortController().signal)
    expect(outcome.status).toBe('streaming')
    db('readChatRun').mockResolvedValue(null)
    expect((await ask(request, new AbortController().signal)).status).toBe('streaming')
  })
})
