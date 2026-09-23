// @vitest-environment node
import type { ThreadNodeKind } from '@folio/contracts'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The gates and parses that stand between a server action and a row -
 * AGENT_READINESS_REPORT.md 3.4, roadmap task 1.1.
 *
 * ## Why these are unit tests at all
 *
 * "No server action has a unit test anywhere" (`docs/remainingroadmap.md`),
 * and the ten Playwright walks that stand in for them drive a browser, which
 * means they can only reach an action the way the UI reaches it. Every defect
 * fixed here is reachable **only** by not being the UI: a `next` field the
 * form never puts there, an id from a sibling episode, an anchor kind the type
 * system had already decided could not arrive. A walk cannot type those.
 *
 * So the gate and the repository are mocked and the action itself runs. That
 * proves the order of operations and the refusal, which is exactly what each
 * of these defects was about, and nothing about SQL - the repository layer's
 * own tests are still owed (`docs/remainingroadmap.md`, Phase 2).
 *
 * `@vitest-environment node`, because these modules are server-only and
 * `@folio/db/env` throws the moment it can see a `window`.
 */

const spies = vi.hoisted(() => ({
  openProject: vi.fn(),
  openEpisode: vi.fn(),
  db: {
    readChat: vi.fn(),
    deleteChat: vi.fn(),
    openThread: vi.fn(),
    replyToThread: vi.fn(),
    listComments: vi.fn(),
    listMemberProfiles: vi.fn(),
    readReelIdsInEpisode: vi.fn(),
    readShotIdsInEpisode: vi.fn(),
    readSceneHeader: vi.fn(),
    insertReelShots: vi.fn(),
    patchShot: vi.fn(),
    bulkPatchShots: vi.fn(),
    addShotReference: vi.fn(),
    appendNote: vi.fn(),
  },
  supabase: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signInWithOAuth: vi.fn(),
  },
}))

/** Next's own `redirect` throws; this one throws something a test can read. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw new Redirected(to)
  },
}))
vi.mock('next/headers', () => ({
  headers: (): Promise<Headers> => Promise.resolve(new Headers({ origin: 'https://folio.test' })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/**
 * Never the developer's own `.env`: a test that needs one is a test that lies
 * elsewhere. Storage is present, so `storageAvailable()` cannot short-circuit
 * an upload before the thing under test runs; nothing here reaches a `PUT`.
 */
vi.mock('@folio/db/env', () => ({
  storageEnv: {
    R2_ACCOUNT_ID: 'account',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'bucket',
    R2_PUBLIC_URL: 'https://cdn.folio.test',
  },
  modelEnv: null,
  assistantEnv: null,
}))

vi.mock('@folio/db', async (actual) => ({ ...(await actual<Record<string, unknown>>()), ...spies.db }))

vi.mock('../lib/auth/server', () => ({
  supabaseServer: (): Promise<unknown> => Promise.resolve({ auth: spies.supabase }),
}))

vi.mock('../lib/script/gate', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  openProject: (...args: readonly unknown[]) => spies.openProject(...args),
  openEpisode: (...args: readonly unknown[]) => spies.openEpisode(...args),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT = '11111111-1111-4111-8111-111111111111'
const EPISODE_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'
const NODE = '44444444-4444-4444-8444-444444444444'
const REEL = '55555555-5555-4555-8555-555555555555'
const SHOT = '66666666-6666-4666-8666-666666666666'

const REFUSAL = { status: 'refused', message: 'That script could not be found.' } as const

const gate = {
  actor: '77777777-7777-4777-8777-777777777777',
  scope: {},
  project: { id: PROJECT },
  episode: { id: EPISODE_ID, slug: 'ep_001' },
  // A real gate always carries the caller's role, and the cores check it again (roadmap task 4.2).
  // Missing, it now fails closed (`meetsRole`, pre-deploy fixes 2026-09-24) - it used to pass as above owner.
  role: 'writer',
}

/** A real PNG header, with `arrayBuffer` watched. Reading it is the defect. */
const watchedImage = (): { readonly file: File; readonly read: ReturnType<typeof vi.fn> } => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const file = new File([bytes], 'frame.png', { type: 'image/png' })
  const read = vi.fn(() => Promise.resolve(bytes.buffer))
  Object.defineProperty(file, 'arrayBuffer', { value: read })
  return { file, read }
}

const formWith = (field: string, file: File): FormData => {
  const form = new FormData()
  form.set(field, file)
  return form
}

/**
 * Load the six action modules once, outside any test's clock. Each pulls in
 * `@folio/db` and Drizzle's whole schema, and the first transform of that
 * graph is slower than a default test timeout - which is a fact about the
 * bundler, not about the code under test.
 */
beforeAll(async () => {
  await Promise.all([
    import('../lib/auth/actions'),
    import('../lib/characters/actions'),
    import('../lib/locations/actions'),
    import('../lib/props/actions'),
    import('../lib/storyboard/actions'),
    import('../lib/assistant/actions'),
    import('../lib/script/actions'),
    import('../lib/production/actions'),
  ])
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  spies.openProject.mockResolvedValue(gate)
  spies.openEpisode.mockResolvedValue(gate)
})

// ---------------------------------------------------------------------------
// (a) The redirect target
// ---------------------------------------------------------------------------

describe('a hostile `next` never reaches redirect()', () => {
  const caught = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run()
    } catch (thrown) {
      if (thrown instanceof Redirected) return thrown.to
      throw thrown
    }
    throw new Error('the action did not redirect')
  }

  const credentials = (next: string): FormData => {
    const form = new FormData()
    form.set('email', 'priya@example.com')
    form.set('password', 'a-long-enough-password')
    form.set('next', next)
    return form
  }

  it('refuses a protocol-relative host on sign-in', async () => {
    // `//evil.example` is the case a `startsWith('/')` check waves through.
    spies.supabase.signInWithPassword.mockResolvedValue({ error: null })
    const { signInWithPassword } = await import('../lib/auth/actions')
    expect(await caught(() => signInWithPassword({ status: 'idle' }, credentials('//evil.example')))).toBe('/app')
  })

  it('refuses an absolute URL on sign-up', async () => {
    spies.supabase.signUp.mockResolvedValue({ data: { session: {} }, error: null })
    const { signUpWithPassword } = await import('../lib/auth/actions')
    expect(await caught(() => signUpWithPassword({ status: 'idle' }, credentials('https://evil.example')))).toBe('/app')
  })

  it('keeps an in-app path, so the parameter still does its job', async () => {
    spies.supabase.signInWithPassword.mockResolvedValue({ error: null })
    const { signInWithPassword } = await import('../lib/auth/actions')
    expect(await caught(() => signInWithPassword({ status: 'idle' }, credentials('/app/project/abc')))).toBe(
      '/app/project/abc',
    )
  })

  it('never plants a hostile value in the OAuth callback URL', async () => {
    // The callback route validates again, but the value is planted here.
    spies.supabase.signInWithOAuth.mockResolvedValue({ data: { url: 'https://supabase.test/authorize' }, error: null })
    const { signInWithGoogle } = await import('../lib/auth/actions')
    const form = new FormData()
    form.set('next', '//evil.example')
    await caught(() => signInWithGoogle({ status: 'idle' }, form))
    const call = spies.supabase.signInWithOAuth.mock.calls[0]?.[0] as { options: { redirectTo: string } }
    expect(call.options.redirectTo).toBe('https://folio.test/auth/callback?next=%2Fapp')
  })
})

// ---------------------------------------------------------------------------
// (b) The gate runs before the body is read
// ---------------------------------------------------------------------------

describe('an upload buffers nothing until the gate has opened', () => {
  beforeEach(() => {
    spies.openProject.mockResolvedValue(REFUSAL)
    spies.openEpisode.mockResolvedValue(REFUSAL)
  })

  it('refuses a portrait without reading the file', async () => {
    const { file, read } = watchedImage()
    const { uploadPortrait } = await import('../lib/characters/actions')
    expect(await uploadPortrait(PROJECT, NODE, formWith('portrait', file))).toEqual(REFUSAL)
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a location photo without reading the file', async () => {
    const { file, read } = watchedImage()
    const { uploadLocationPhoto } = await import('../lib/locations/actions')
    expect(await uploadLocationPhoto(PROJECT, NODE, formWith('photo', file))).toEqual(REFUSAL)
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a prop photo without reading the file', async () => {
    const { file, read } = watchedImage()
    const { uploadPropPhoto } = await import('../lib/props/actions')
    expect(await uploadPropPhoto(PROJECT, NODE, formWith('photo', file))).toEqual(REFUSAL)
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a storyboard frame without reading the file', async () => {
    const { file, read } = watchedImage()
    const { uploadFrame } = await import('../lib/storyboard/actions')
    expect(await uploadFrame(PROJECT, 'ep_001', SHOT, formWith('frame', file))).toEqual(REFUSAL)
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a production reference without reading the file', async () => {
    // Production already gated first; this holds it there.
    const { file, read } = watchedImage()
    const { uploadReference } = await import('../lib/production/actions')
    expect(await uploadReference(PROJECT, 'ep_001', SHOT, formWith('image', file))).toEqual(REFUSAL)
    expect(read).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// (c) A chat belongs to one episode
// ---------------------------------------------------------------------------

describe('deleting an assistant chat', () => {
  it('refuses a chat of a sibling episode', async () => {
    spies.db.readChat.mockResolvedValue({ id: OTHER_ID, episodeId: OTHER_ID })
    const { deleteAssistantChat } = await import('../lib/assistant/actions')
    expect(await deleteAssistantChat(PROJECT, 'ep_001', OTHER_ID)).toEqual({
      status: 'error',
      message: 'That chat could not be found.',
    })
    expect(spies.db.deleteChat).not.toHaveBeenCalled()
  })

  it('deletes a chat of this episode', async () => {
    spies.db.readChat.mockResolvedValue({ id: OTHER_ID, episodeId: EPISODE_ID })
    const { deleteAssistantChat } = await import('../lib/assistant/actions')
    expect(await deleteAssistantChat(PROJECT, 'ep_001', OTHER_ID)).toEqual({ status: 'done' })
    expect(spies.db.deleteChat).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// (d) The thread anchor and the node id
// ---------------------------------------------------------------------------

describe('opening and replying to a comment thread', () => {
  beforeEach(() => {
    spies.db.openThread.mockResolvedValue({ id: OTHER_ID, state: 'open' })
    spies.db.listComments.mockResolvedValue([])
    spies.db.listMemberProfiles.mockResolvedValue([])
  })

  it('refuses an anchor kind no editor can open', async () => {
    const { openThreadOnNode } = await import('../lib/script/actions')
    // `storyboard_shot` is a real thread anchor and not a node one: a thread
    // opened under it is drawn by neither route. The assertion is what a
    // caller that is not this app's React does for free.
    const kind: string = 'storyboard_shot'
    expect(await openThreadOnNode(PROJECT, 'ep_001', NODE, 'a note', kind as ThreadNodeKind)).toEqual({
      status: 'error',
      message: 'Write a comment first.',
    })
    expect(spies.db.openThread).not.toHaveBeenCalled()
  })

  it('opens a thread on the two kinds an editor does anchor', async () => {
    const { openThreadOnNode } = await import('../lib/script/actions')
    expect((await openThreadOnNode(PROJECT, 'ep_001', NODE, 'a note', 'outline_block')).status).toBe('ok')
    expect(spies.db.openThread).toHaveBeenCalledOnce()
  })

  it('refuses a reply whose node id is not an id', async () => {
    const { replyThread } = await import('../lib/script/actions')
    expect(await replyThread(PROJECT, 'ep_001', OTHER_ID, 'not-a-node', 'a reply')).toEqual({
      status: 'error',
      message: 'Write a reply first.',
    })
    expect(spies.db.replyToThread).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// (e) A reel, a shot and a note belong to this episode
// ---------------------------------------------------------------------------

describe('Production writes check the episode, not only the project', () => {
  const NOT_A_SHOT = 'That shot is not on this board. Reload the page.'
  const NOT_A_REEL = 'That reel is not in this episode. Reload the page.'

  it('refuses a shot added to a reel of another episode', async () => {
    spies.db.readReelIdsInEpisode.mockResolvedValue(new Set())
    const { addShot } = await import('../lib/production/actions')
    expect(await addShot(PROJECT, 'ep_001', { reelId: REEL })).toEqual({ status: 'error', message: NOT_A_REEL })
    expect(spies.db.insertReelShots).not.toHaveBeenCalled()
  })

  it('adds a shot to a reel of this episode', async () => {
    spies.db.readReelIdsInEpisode.mockResolvedValue(new Set([REEL]))
    spies.db.insertReelShots.mockResolvedValue([{ id: SHOT, frameAssetId: null, referenceAssetIds: [] }])
    const { addShot } = await import('../lib/production/actions')
    expect((await addShot(PROJECT, 'ep_001', { reelId: REEL })).status).toBe('saved')
  })

  it('refuses a patch to a shot of another episode', async () => {
    spies.db.readShotIdsInEpisode.mockResolvedValue(new Set())
    const { patchShot } = await import('../lib/production/actions')
    expect(await patchShot(PROJECT, 'ep_001', SHOT, { title: 'x' })).toEqual({ status: 'error', message: NOT_A_SHOT })
    expect(spies.db.patchShot).not.toHaveBeenCalled()
  })

  it('refuses a bulk patch when one id is from another episode', async () => {
    // One foreign id refuses the batch: a partial write is worse than none,
    // and the bulk bar can only have sent ids it drew.
    spies.db.readShotIdsInEpisode.mockResolvedValue(new Set([SHOT]))
    const { bulkPatchShots } = await import('../lib/production/actions')
    const input = { ids: [SHOT, OTHER_ID], patch: { priority: 'high' } }
    expect(await bulkPatchShots(PROJECT, 'ep_001', input)).toEqual({ status: 'error', message: NOT_A_SHOT })
    expect(spies.db.bulkPatchShots).not.toHaveBeenCalled()
  })

  it('applies a bulk patch when every id is this episode’s', async () => {
    spies.db.readShotIdsInEpisode.mockResolvedValue(new Set([SHOT, OTHER_ID]))
    spies.db.bulkPatchShots.mockResolvedValue(2)
    const { bulkPatchShots } = await import('../lib/production/actions')
    const input = { ids: [SHOT, OTHER_ID], patch: { priority: 'high' } }
    expect(await bulkPatchShots(PROJECT, 'ep_001', input)).toEqual({ status: 'saved', changed: 2 })
  })

  it('refuses a reference attached to a shot of another episode', async () => {
    spies.db.readShotIdsInEpisode.mockResolvedValue(new Set())
    const { file } = watchedImage()
    const { uploadReference } = await import('../lib/production/actions')
    expect(await uploadReference(PROJECT, 'ep_001', SHOT, formWith('image', file))).toEqual({
      status: 'error',
      message: NOT_A_SHOT,
    })
    expect(spies.db.addShotReference).not.toHaveBeenCalled()
  })

  it('refuses a note on a target that is not in this episode', async () => {
    spies.db.readSceneHeader.mockResolvedValue(null)
    const { saveNote } = await import('../lib/production/actions')
    const input = { targetType: 'scene', targetId: NODE, body: 'a note' }
    expect(await saveNote(PROJECT, 'ep_001', input)).toEqual({
      status: 'error',
      message: 'A note names what it is about.',
    })
    expect(spies.db.appendNote).not.toHaveBeenCalled()
  })

  it('writes a note on a scene of this episode', async () => {
    spies.db.readSceneHeader.mockResolvedValue({ sceneNodeId: NODE, number: 1 })
    const { saveNote } = await import('../lib/production/actions')
    const input = { targetType: 'scene', targetId: NODE, body: 'a note' }
    expect(await saveNote(PROJECT, 'ep_001', input)).toEqual({ status: 'saved' })
    expect(spies.db.appendNote).toHaveBeenCalledOnce()
  })
})
