// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * One pass for a batch of writes - roadmap task 1.5.
 *
 * The property under test is a count: how many times the whole-project
 * derivation runs for a given sequence of writes. Both halves matter equally -
 * one pass for a batch is the point, and *one pass per write outside a batch*
 * is the promise that this changes nothing for every route in the app.
 */

const spies = vi.hoisted(() => ({
  rederiveProject: vi.fn(),
  openProject: vi.fn(),
  createCharacterRecord: vi.fn(),
  bindCue: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@folio/db/env', () => ({ storageEnv: null, modelEnv: null, assistantEnv: null }))

vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  createCharacterRecord: (...args: readonly unknown[]) => spies.createCharacterRecord(...args),
  bindCue: (...args: readonly unknown[]) => spies.bindCue(...args),
}))

vi.mock('../lib/script/server', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  rederiveProject: (...args: readonly unknown[]) => spies.rederiveProject(...args),
}))

vi.mock('../lib/script/gate', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  openProject: (...args: readonly unknown[]) => spies.openProject(...args),
}))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const RECORD = '33333333-3333-4333-8333-333333333333'
const scope = {}
const gate = { actor: RECORD, scope, project: { id: PROJECT }, role: 'writer' }

/** The module graph is large; loading it inside a test spends that test's clock. */
beforeAll(async () => {
  await Promise.all([import('../lib/characters/actions'), import('../lib/script/derive-batch')])
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  spies.openProject.mockResolvedValue(gate)
  spies.createCharacterRecord.mockResolvedValue(RECORD)
  spies.rederiveProject.mockResolvedValue({ ok: true, derivation: { entities: { characters: [] } } })
})

describe('outside a batch, nothing changes', () => {
  it('runs a pass per write, as it always has', async () => {
    const { createCharacter } = await import('../lib/characters/actions')
    await createCharacter(PROJECT, { name: 'RUKMINI' })
    await createCharacter(PROJECT, { name: 'MEERA' })
    expect(spies.rederiveProject).toHaveBeenCalledTimes(2)
  })

  it('hands the action the pass itself, not a deferred stand-in', async () => {
    const { requestRederive } = await import('../lib/script/derive-batch')
    const outcome = await requestRederive(scope as never)
    expect(outcome).toEqual({ ok: true, derivation: { entities: { characters: [] } } })
  })
})

describe('inside a batch', () => {
  it('five creates cause exactly one derivation pass', async () => {
    const { createCharacter } = await import('../lib/characters/actions')
    const { withDeferredDerive } = await import('../lib/script/derive-batch')

    const names = ['RUKMINI', 'MEERA', 'ARJUN', 'KABIR', 'LEELA']
    const batch = await withDeferredDerive(scope as never, async () => {
      for (const name of names) await createCharacter(PROJECT, { name })
      return names.length
    })

    expect(batch.value).toBe(5)
    expect(spies.createCharacterRecord).toHaveBeenCalledTimes(5)
    expect(spies.rederiveProject).toHaveBeenCalledTimes(1)
    expect(batch.derived).toEqual({ ok: true, derivation: { entities: { characters: [] } } })
  })

  it('runs no pass at all when nothing asked for one', async () => {
    const { withDeferredDerive } = await import('../lib/script/derive-batch')
    const batch = await withDeferredDerive(scope as never, () => Promise.resolve('nothing written'))
    expect(spies.rederiveProject).not.toHaveBeenCalled()
    expect(batch.derived).toBeNull()
  })

  it('reports a failed pass rather than swallowing it', async () => {
    // The writes have already answered by the time the pass runs, so its
    // failure has nowhere else to go.
    spies.rederiveProject.mockResolvedValue({ ok: false, error: { kind: 'unreadable' } })
    const { createCharacter } = await import('../lib/characters/actions')
    const { withDeferredDerive } = await import('../lib/script/derive-batch')
    const batch = await withDeferredDerive(scope as never, () => createCharacter(PROJECT, { name: 'RUKMINI' }))
    expect(batch.derived).toEqual({ ok: false, error: { kind: 'unreadable' } })
  })

  it('answers a request with a deferred pass, not a failure', async () => {
    const { requestRederive, withDeferredDerive, inDeriveBatch } = await import('../lib/script/derive-batch')
    await withDeferredDerive(scope as never, async () => {
      expect(inDeriveBatch()).toBe(true)
      expect(await requestRederive(scope as never)).toEqual({ ok: true, derivation: null })
    })
    expect(inDeriveBatch()).toBe(false)
  })

  it('does not leak into work running beside it', async () => {
    // Two batches in one process must not see each other's requests, and a
    // call outside both must still run its own pass.
    const { createCharacter } = await import('../lib/characters/actions')
    const { withDeferredDerive } = await import('../lib/script/derive-batch')
    await Promise.all([
      withDeferredDerive(scope as never, () => createCharacter(PROJECT, { name: 'ONE' })),
      withDeferredDerive(scope as never, () => createCharacter(PROJECT, { name: 'TWO' })),
      createCharacter(PROJECT, { name: 'THREE' }),
    ])
    expect(spies.rederiveProject).toHaveBeenCalledTimes(3)
  })
})
