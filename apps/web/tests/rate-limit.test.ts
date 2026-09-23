// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { RATE_LIMITS } from '../lib/agent/limits'

/**
 * Fixed-window rate limits - roadmap task 1.7, ADR 0003 **D14**.
 *
 * The counting itself is one `INSERT … ON CONFLICT` and only Postgres can
 * prove it is atomic. What is provable here is everything around it: that a
 * refusal reaches the caller as a refusal rather than as silence, that it
 * carries a number of seconds somebody can act on, that the work does not
 * happen, and that the one action deliberately exempt from the limit really
 * is exempt.
 */

const spies = vi.hoisted(() => ({
  touchRateLimit: vi.fn(),
  openEpisode: vi.fn(),
  createGeneration: vi.fn(),
  cancelGenerationRow: vi.fn(),
  readProductionEpisode: vi.fn(),
  readLiveGenerationFor: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@folio/db/env', () => ({
  storageEnv: {
    R2_ACCOUNT_ID: 'account',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'bucket',
    R2_PUBLIC_URL: 'https://cdn.folio.test',
  },
  modelEnv: { GEMINI_API_KEY: 'test-key' },
  assistantEnv: null,
}))

vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  touchRateLimit: (...args: readonly unknown[]) => spies.touchRateLimit(...args),
  createGeneration: (...args: readonly unknown[]) => spies.createGeneration(...args),
  cancelGeneration: (...args: readonly unknown[]) => spies.cancelGenerationRow(...args),
  readProductionEpisode: (...args: readonly unknown[]) => spies.readProductionEpisode(...args),
  readLiveGenerationFor: (...args: readonly unknown[]) => spies.readLiveGenerationFor(...args),
}))

vi.mock('../lib/script/gate', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  openEpisode: (...args: readonly unknown[]) => spies.openEpisode(...args),
}))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const REEL = '33333333-3333-4333-8333-333333333333'
const GENERATION = '44444444-4444-4444-8444-444444444444'
const scope = {}

beforeAll(async () => {
  await Promise.all([import('../lib/production/generate'), import('../lib/agent/rate-limit')])
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  spies.openEpisode.mockResolvedValue({
    actor: ACTOR,
    scope,
    project: { id: PROJECT },
    episode: { id: REEL, slug: 'ep_001' },
    role: 'writer',
  })
  spies.touchRateLimit.mockResolvedValue({ allowed: true, used: 1, limit: 30 })
})

describe('the numbers are ADR 0003 D14 and nothing else', () => {
  it('is 60 assistant requests and 30 generations an hour', () => {
    expect(RATE_LIMITS.assistant).toBe(60)
    expect(RATE_LIMITS.generate).toBe(30)
  })
})

describe('the helper', () => {
  it('says nothing when the caller is under the limit', async () => {
    const { checkRateLimit } = await import('../lib/agent/rate-limit')
    expect(await checkRateLimit(scope as never, ACTOR as never, 'assistant')).toBeNull()
    expect(spies.touchRateLimit).toHaveBeenCalledWith(scope, ACTOR, 'assistant', 60)
  })

  it('names the limit and when to come back', async () => {
    spies.touchRateLimit.mockResolvedValue({ allowed: false, limit: 60, retryAfterSeconds: 1_200 })
    const { checkRateLimit } = await import('../lib/agent/rate-limit')
    const limited = await checkRateLimit(scope as never, ACTOR as never, 'assistant')
    expect(limited).toMatchObject({ status: 'rate-limited', retryAfterSeconds: 1_200 })
    expect(limited?.message).toContain('60 assistant requests')
    expect(limited?.message).toContain('20 minutes')
  })

  it('counts seconds rather than rounding a short wait to zero minutes', async () => {
    spies.touchRateLimit.mockResolvedValue({ allowed: false, limit: 30, retryAfterSeconds: 12 })
    const { checkRateLimit } = await import('../lib/agent/rate-limit')
    const limited = await checkRateLimit(scope as never, ACTOR as never, 'generate')
    expect(limited?.message).toContain('12 seconds')
  })
})

describe('a generation that starts work', () => {
  it('is refused when the window is full, and starts nothing', async () => {
    spies.touchRateLimit.mockResolvedValue({ allowed: false, limit: 30, retryAfterSeconds: 300 })
    const { generateSheet } = await import('../lib/production/generate')
    const outcome = await generateSheet(PROJECT, 'ep_001', REEL)
    expect(outcome.status).toBe('rate-limited')
    if (outcome.status === 'rate-limited') expect(outcome.retryAfterSeconds).toBe(300)
    expect(spies.createGeneration).not.toHaveBeenCalled()
    // The refusal comes before the reads the job would need.
    expect(spies.readProductionEpisode).not.toHaveBeenCalled()
  })

  it('counts against the generate bucket, not the assistant one', async () => {
    spies.touchRateLimit.mockResolvedValue({ allowed: false, limit: 30, retryAfterSeconds: 300 })
    const { shootReel } = await import('../lib/production/generate')
    await shootReel(PROJECT, 'ep_001', REEL)
    expect(spies.touchRateLimit).toHaveBeenCalledWith(scope, ACTOR, 'generate', 30)
  })
})

describe('cancelling is exempt, on purpose', () => {
  it('does not touch the counter at all', async () => {
    // A caller can only reach a cancel refusal by having made thirty
    // generations this hour - which is exactly the person who most needs the
    // stop button on work that is running and holding credits.
    spies.cancelGenerationRow.mockResolvedValue({ status: 'cancelled', generation: {} })
    const { cancelGeneration } = await import('../lib/production/generate')
    expect(await cancelGeneration(PROJECT, 'ep_001', GENERATION)).toEqual({ status: 'cancelled' })
    expect(spies.touchRateLimit).not.toHaveBeenCalled()
  })
})
