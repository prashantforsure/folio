// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../lib/idempotency'

/**
 * A create that a retry may repeat - roadmap task 1.3, migration `0031`.
 *
 * The uniqueness itself is a partial index and only Postgres can prove it
 * holds; what is provable here is the contract *around* it, which is where the
 * mistakes are: that the key reaches the repository at all, that an absent key
 * stays absent rather than becoming an empty string (which would make every
 * UI create collide with every other), and that a malformed key refuses
 * instead of being quietly dropped - the failure mode that removes the
 * protection at the moment somebody is relying on it.
 */

const spies = vi.hoisted(() => ({
  openProject: vi.fn(),
  openEpisode: vi.fn(),
  createCharacterRecord: vi.fn(),
  createLocationRecord: vi.fn(),
  createPropRecord: vi.fn(),
  createResearchSource: vi.fn(),
  createStoryThread: vi.fn(),
  appendEpisode: vi.fn(),
  bindCue: vi.fn(),
  bindSlugline: vi.fn(),
  bindPropAlias: vi.fn(),
  listEpisodes: vi.fn(),
  rederive: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@folio/db/env', () => ({ storageEnv: null, modelEnv: null, assistantEnv: null }))

vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  createCharacterRecord: (...args: readonly unknown[]) => spies.createCharacterRecord(...args),
  createLocationRecord: (...args: readonly unknown[]) => spies.createLocationRecord(...args),
  createPropRecord: (...args: readonly unknown[]) => spies.createPropRecord(...args),
  createResearchSource: (...args: readonly unknown[]) => spies.createResearchSource(...args),
  createStoryThread: (...args: readonly unknown[]) => spies.createStoryThread(...args),
  appendEpisode: (...args: readonly unknown[]) => spies.appendEpisode(...args),
  bindCue: (...args: readonly unknown[]) => spies.bindCue(...args),
  bindSlugline: (...args: readonly unknown[]) => spies.bindSlugline(...args),
  bindPropAlias: (...args: readonly unknown[]) => spies.bindPropAlias(...args),
  listEpisodes: (...args: readonly unknown[]) => spies.listEpisodes(...args),
}))

vi.mock('../lib/script/gate', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  openProject: (...args: readonly unknown[]) => spies.openProject(...args),
  openEpisode: (...args: readonly unknown[]) => spies.openEpisode(...args),
}))

vi.mock('../lib/script/server', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  rederiveProject: (...args: readonly unknown[]) => spies.rederive(...args),
}))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const RECORD = '33333333-3333-4333-8333-333333333333'
const KEY = 'toolu_01ABCdefGHIjklMNOpqr'

const gate = {
  actor: '22222222-2222-4222-8222-222222222222',
  scope: {},
  project: { id: PROJECT, projectType: 'series' },
  episode: { id: RECORD, slug: 'ep_001' },
  role: 'writer',
}

beforeAll(async () => {
  await Promise.all([
    import('../lib/characters/actions'),
    import('../lib/locations/actions'),
    import('../lib/props/actions'),
    import('../lib/research/actions'),
    import('../lib/timeline/actions'),
    import('../lib/workspace/actions'),
  ])
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  spies.openProject.mockResolvedValue(gate)
  spies.openEpisode.mockResolvedValue(gate)
  spies.createCharacterRecord.mockResolvedValue(RECORD)
  spies.createLocationRecord.mockResolvedValue(RECORD)
  spies.createPropRecord.mockResolvedValue(RECORD)
  spies.createResearchSource.mockResolvedValue({ ok: true, id: RECORD })
  spies.createStoryThread.mockResolvedValue(RECORD)
  spies.appendEpisode.mockResolvedValue({ id: RECORD, slug: 'ep_002', ordinal: 2, title: 'Two' })
  spies.listEpisodes.mockResolvedValue([{ id: RECORD, slug: 'ep_001', ordinal: 1, title: 'One' }])
})

describe('reading the key', () => {
  it('treats absent as not-retryable rather than as a key', () => {
    expect(idempotencyKeyOf(null)).toEqual({ ok: true, key: null })
    expect(idempotencyKeyOf(undefined)).toEqual({ ok: true, key: null })
  })

  it('refuses a key that is not one, rather than dropping it', () => {
    // Dropping it would leave the caller believing they were protected.
    expect(idempotencyKeyOf('')).toEqual({ ok: false })
    expect(idempotencyKeyOf('   ')).toEqual({ ok: false })
    expect(idempotencyKeyOf(42)).toEqual({ ok: false })
    expect(idempotencyKeyOf('x'.repeat(201))).toEqual({ ok: false })
  })

  it('trims, because whitespace either side is the same call', () => {
    expect(idempotencyKeyOf(`  ${KEY}  `)).toEqual({ ok: true, key: KEY })
  })
})

describe('every create passes the key through to its repository', () => {
  it('createCharacter', async () => {
    const { createCharacter } = await import('../lib/characters/actions')
    await createCharacter(PROJECT, { name: 'RUKMINI' }, KEY)
    expect(spies.createCharacterRecord).toHaveBeenCalledWith({}, 'RUKMINI', {}, 'hand', KEY)
  })

  it('createLocation', async () => {
    const { createLocation } = await import('../lib/locations/actions')
    await createLocation(PROJECT, 'HARBOUR', null, KEY)
    expect(spies.createLocationRecord).toHaveBeenCalledWith({}, 'HARBOUR', null, KEY)
  })

  it('createProp', async () => {
    const { createProp } = await import('../lib/props/actions')
    await createProp(PROJECT, 'Game ball', null, KEY)
    expect(spies.createPropRecord).toHaveBeenCalledWith({}, 'Game ball', null, KEY)
  })

  it('addSource', async () => {
    const { addSource } = await import('../lib/research/actions')
    const source = { kind: 'article', title: 'A paper', origin: '', note: '', body: '', collection: null }
    await addSource(PROJECT, source, KEY)
    expect(spies.createResearchSource).toHaveBeenCalledWith({}, expect.objectContaining({ title: 'A paper' }), KEY)
  })

  it('createThread', async () => {
    const { createThread } = await import('../lib/timeline/actions')
    await createThread(PROJECT, { name: 'The hunt', colour: 'teal' }, KEY)
    expect(spies.createStoryThread).toHaveBeenCalledWith({}, { name: 'The hunt', colour: 'teal' }, KEY)
  })

  it('createEpisode', async () => {
    const { createEpisode } = await import('../lib/workspace/actions')
    await createEpisode(PROJECT, 'Two', KEY)
    expect(spies.appendEpisode).toHaveBeenCalledWith({}, 'Two', KEY)
  })
})

describe('a create with no key is unchanged', () => {
  it('passes null, never an empty string', async () => {
    // An empty string is a *value*: with the index in place, every UI create
    // in a project would collide with every other one.
    const { createCharacter } = await import('../lib/characters/actions')
    await createCharacter(PROJECT, { name: 'RUKMINI' })
    expect(spies.createCharacterRecord).toHaveBeenCalledWith({}, 'RUKMINI', {}, 'hand', null)
  })
})

describe('a malformed key refuses before anything is written', () => {
  it('characters', async () => {
    const { createCharacter } = await import('../lib/characters/actions')
    expect(await createCharacter(PROJECT, { name: 'RUKMINI' }, '')).toEqual({
      status: 'error',
      message: BAD_IDEMPOTENCY_KEY,
    })
    expect(spies.createCharacterRecord).not.toHaveBeenCalled()
    expect(spies.openProject).not.toHaveBeenCalled()
  })

  it('episodes', async () => {
    const { createEpisode } = await import('../lib/workspace/actions')
    expect(await createEpisode(PROJECT, 'Two', 42)).toEqual({ status: 'error', message: BAD_IDEMPOTENCY_KEY })
    expect(spies.appendEpisode).not.toHaveBeenCalled()
  })
})
