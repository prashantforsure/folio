// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MembershipRole } from '@folio/contracts'

import { ROLE, ROLE_ORDER, ROLE_REFUSED, meetsRole } from '../lib/auth/roles'

/**
 * What a role lets somebody do - ADR 0003 **D2**, roadmap task 1.2.
 *
 * ## The gate here is the real one
 *
 * `lib/auth/roles.ts` is the table and `lib/script/gate.ts` is the one place
 * it is applied, so these tests mock neither. What is mocked is everything
 * *underneath* the gate - the identity, the membership row, the project and
 * the episode - and the action then runs for real. That is the only way to
 * prove the sentence D2 is made of: "a `reader` invited by a share link can
 * rename, merge, re-derive, upload, spend credits and hard-delete an episode"
 * must stop being true, action by action, and a test that mocked the gate
 * would prove only that a constant was passed to it.
 *
 * ## Why one write per module
 *
 * Ninety-nine actions take a capability from the same table, and asserting one
 * of each would be asserting the table against itself. What can go wrong per
 * module is the *wiring*: a module whose gate call was missed refuses nobody.
 * So every module answers for one write, and the ordering - that `writer` and
 * `owner` are let through where `reader` is not - is proved separately, on the
 * gate, where the comparison actually lives.
 */

const spies = vi.hoisted(() => ({
  currentIdentity: vi.fn(),
  readMembershipFor: vi.fn(),
  readProject: vi.fn(),
  readEpisodeBySlug: vi.fn(),
  transactionDatabase: vi.fn(),
  openProjectForRequest: vi.fn(),
  appendEpisode: vi.fn(),
  listEpisodes: vi.fn(),
  rename: vi.fn(),
  removeEpisode: vi.fn(),
  createCharacterRecord: vi.fn(),
  listCharacterRecords: vi.fn(),
  listBoundCues: vi.fn(),
  readDocumentByKind: vi.fn(),
  readScreenplayNodes: vi.fn(),
  createChat: vi.fn(),
  listChats: vi.fn(),
  issueShareLink: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw new Error(`redirect ${to}`)
  },
}))
/**
 * A model key, so `connected()` in `lib/production/generate.ts` does not
 * refuse before the gate is reached - the point of that test is the gate.
 */
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

vi.mock('../lib/auth/session', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  currentIdentity: () => spies.currentIdentity(),
  requireUser: () => spies.currentIdentity(),
}))

vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  transactionDatabase: () => spies.transactionDatabase(),
  openProjectForRequest: (...args: readonly unknown[]) => spies.openProjectForRequest(...args),
  readMembershipFor: (...args: readonly unknown[]) => spies.readMembershipFor(...args),
  readProject: (...args: readonly unknown[]) => spies.readProject(...args),
  readEpisodeBySlug: (...args: readonly unknown[]) => spies.readEpisodeBySlug(...args),
  appendEpisode: (...args: readonly unknown[]) => spies.appendEpisode(...args),
  listEpisodes: (...args: readonly unknown[]) => spies.listEpisodes(...args),
  rename: (...args: readonly unknown[]) => spies.rename(...args),
  deleteEpisode: (...args: readonly unknown[]) => spies.removeEpisode(...args),
  createCharacterRecord: (...args: readonly unknown[]) => spies.createCharacterRecord(...args),
  listCharacterRecords: (...args: readonly unknown[]) => spies.listCharacterRecords(...args),
  listBoundCues: (...args: readonly unknown[]) => spies.listBoundCues(...args),
  readDocumentByKind: (...args: readonly unknown[]) => spies.readDocumentByKind(...args),
  readScreenplayNodes: (...args: readonly unknown[]) => spies.readScreenplayNodes(...args),
  createChat: (...args: readonly unknown[]) => spies.createChat(...args),
  listChats: (...args: readonly unknown[]) => spies.listChats(...args),
  issueShareLink: (...args: readonly unknown[]) => spies.issueShareLink(...args),
}))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const RECORD = '33333333-3333-4333-8333-333333333333'
const EPISODE = 'ep_001'

/** Who the caller is on this project, for the one statement the gate reads it with. */
const asRole = (role: 'reader' | 'writer' | 'owner'): void => {
  spies.readMembershipFor.mockResolvedValue({ role })
}

beforeAll(async () => {
  await Promise.all([
    import('../lib/characters/actions'),
    import('../lib/locations/actions'),
    import('../lib/props/actions'),
    import('../lib/research/actions'),
    import('../lib/timeline/actions'),
    import('../lib/scenes/actions'),
    import('../lib/outline/actions'),
    import('../lib/script/actions'),
    import('../lib/storyboard/actions'),
    import('../lib/production/actions'),
    import('../lib/production/generate'),
    import('../lib/assistant/actions'),
    import('../lib/share/actions'),
    import('../lib/workspace/actions'),
    import('../lib/projects/actions'),
  ])
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  spies.currentIdentity.mockResolvedValue({ id: ACTOR })
  spies.transactionDatabase.mockResolvedValue({})
  spies.openProjectForRequest.mockResolvedValue({})
  spies.readProject.mockResolvedValue({ id: PROJECT, kind: 'screenwriting', projectType: 'series', title: 'A project' })
  spies.readEpisodeBySlug.mockResolvedValue({ id: RECORD, slug: EPISODE, ordinal: 1, title: 'One' })
  asRole('reader')
})

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------

describe('the role order', () => {
  it('is reader < writer < owner', () => {
    expect([...ROLE_ORDER]).toEqual(['reader', 'writer', 'owner'])
  })

  it('lets a role reach its own minimum and everything below it', () => {
    expect(meetsRole('reader', 'reader')).toBe(true)
    expect(meetsRole('writer', 'reader')).toBe(true)
    expect(meetsRole('owner', 'writer')).toBe(true)
    expect(meetsRole('owner', 'owner')).toBe(true)
  })

  it('stops a role short of a higher minimum', () => {
    expect(meetsRole('reader', 'writer')).toBe(false)
    expect(meetsRole('reader', 'owner')).toBe(false)
    expect(meetsRole('writer', 'owner')).toBe(false)
  })

  // Every known role against every minimum: the whole matrix, not a sample of it.
  const MATRIX: readonly (readonly [MembershipRole, MembershipRole, boolean])[] = [
    ['reader', 'reader', true],
    ['reader', 'writer', false],
    ['reader', 'owner', false],
    ['writer', 'reader', true],
    ['writer', 'writer', true],
    ['writer', 'owner', false],
    ['owner', 'reader', true],
    ['owner', 'writer', true],
    ['owner', 'owner', true],
  ]
  it.each(MATRIX)('a %s against a %s minimum: %s', (held, minimum, meets) => {
    expect(meetsRole(held, minimum)).toBe(meets)
  })

  // Fails closed: a role this table does not know meets nothing - it used to outrank an owner.
  const UNKNOWN: readonly (readonly [string, MembershipRole | null | undefined])[] = [
    ['an unknown role', 'admin' as MembershipRole],
    ['an empty role', '' as MembershipRole],
    ['a null role', null],
    ['a missing role', undefined],
  ]
  describe.each(UNKNOWN)('%s', (_label, held) => {
    it.each(ROLE_ORDER.map((minimum) => [minimum] as const))('meets no %s minimum', (minimum) => {
      expect(meetsRole(held, minimum)).toBe(false)
    })
  })

  it('lets nobody meet a minimum the table does not know', () => {
    for (const held of ROLE_ORDER) expect(meetsRole(held, 'admin' as MembershipRole)).toBe(false)
  })

  it('puts every capability D2 names at the role D2 gives it', () => {
    // The matrix read back as prose, so a row moved between roles has to be
    // moved here too - which is the moment somebody asks whether D2 changed.
    expect(ROLE.read).toBe('reader')
    expect(ROLE.comment).toBe('reader')
    expect(ROLE.export).toBe('reader')
    expect(ROLE.authoredEdit).toBe('writer')
    expect(ROLE.entityOperation).toBe('writer')
    expect(ROLE.productionEdit).toBe('writer')
    expect(ROLE.paidGeneration).toBe('writer')
    expect(ROLE.shareLink).toBe('writer')
    expect(ROLE.episodeCreate).toBe('writer')
    expect(ROLE.episodeDelete).toBe('owner')
    expect(ROLE.projectAdmin).toBe('owner')
  })
})

// ---------------------------------------------------------------------------
// One write per action module
// ---------------------------------------------------------------------------

const refused = { status: 'refused', message: ROLE_REFUSED }

describe('a reader is refused a write, in every action module', () => {
  it('characters', async () => {
    const { createCharacter } = await import('../lib/characters/actions')
    expect(await createCharacter(PROJECT, { name: 'RUKMINI' })).toEqual(refused)
    expect(spies.createCharacterRecord).not.toHaveBeenCalled()
  })

  it('locations', async () => {
    const { createLocation } = await import('../lib/locations/actions')
    expect(await createLocation(PROJECT, 'HARBOUR')).toEqual(refused)
  })

  it('props', async () => {
    const { createProp } = await import('../lib/props/actions')
    expect(await createProp(PROJECT, 'Game ball')).toEqual(refused)
  })

  it('research', async () => {
    const { addSource } = await import('../lib/research/actions')
    const source = { kind: 'article', title: 'A paper', origin: '', note: '', body: '', collection: null }
    expect(await addSource(PROJECT, source)).toEqual(refused)
  })

  it('timeline', async () => {
    const { createThread } = await import('../lib/timeline/actions')
    expect(await createThread(PROJECT, { name: 'The hunt', colour: 'teal' })).toEqual(refused)
  })

  it('scenes', async () => {
    const { saveSynopsis } = await import('../lib/scenes/actions')
    const input = { projectId: PROJECT, episode: EPISODE, sceneNodeId: RECORD, synopsis: 'They meet.' }
    expect(await saveSynopsis(input)).toEqual(refused)
  })

  it('script', async () => {
    const { createBlankScript } = await import('../lib/script/actions')
    expect(await createBlankScript(PROJECT, EPISODE)).toEqual(refused)
  })

  it('outline', async () => {
    const { saveOutline } = await import('../lib/outline/actions')
    const input = {
      projectId: PROJECT,
      episode: EPISODE,
      documentId: null,
      baseUpdatedAt: new Date().toISOString(),
      nodes: [],
      retirements: [],
      snapshot: false,
    }
    expect(await saveOutline(input)).toEqual(refused)
  })

  it('storyboard', async () => {
    const { acceptShots } = await import('../lib/storyboard/actions')
    expect(await acceptShots(PROJECT, EPISODE, { sceneNodeId: RECORD, shotIds: [RECORD] })).toEqual(refused)
  })

  it('production', async () => {
    const { addReel } = await import('../lib/production/actions')
    expect(await addReel(PROJECT, EPISODE, RECORD)).toEqual(refused)
  })

  it('production generations, which spend credits', async () => {
    const { shootReel } = await import('../lib/production/generate')
    expect(await shootReel(PROJECT, EPISODE, RECORD)).toEqual(refused)
  })

  it('share links', async () => {
    const { issueShareLink } = await import('../lib/share/actions')
    expect(await issueShareLink(PROJECT, 'writer')).toEqual(refused)
  })

  it('episodes', async () => {
    const { renameEpisode } = await import('../lib/workspace/actions')
    expect(await renameEpisode(PROJECT, EPISODE, 'Two')).toEqual({ status: 'error', message: ROLE_REFUSED })
    expect(spies.rename).not.toHaveBeenCalled()
  })

  it('projects', async () => {
    const { archiveProjects } = await import('../lib/projects/actions')
    const form = new FormData()
    form.set('projectId', PROJECT)
    const outcome = await archiveProjects({ status: 'idle' }, form)
    expect(outcome).toMatchObject({ message: ROLE_REFUSED })
  })
})

// ---------------------------------------------------------------------------
// A reader may still read
// ---------------------------------------------------------------------------

describe('a reader is allowed a read', () => {
  it('previews a rename without being able to perform one', async () => {
    spies.listCharacterRecords.mockResolvedValue([{ id: RECORD, name: 'RUKMINI' }])
    spies.listBoundCues.mockResolvedValue([])
    spies.listEpisodes.mockResolvedValue([])
    const { previewRename, renameCharacter } = await import('../lib/characters/actions')
    expect((await previewRename(PROJECT, RECORD, 'MEERA')).status).toBe('preview')
    expect(await renameCharacter(PROJECT, RECORD, 'MEERA')).toEqual(refused)
  })

  it('opens the assistant panel, which is read-only by construction', async () => {
    spies.listChats.mockResolvedValue([])
    const { listAssistantChats } = await import('../lib/assistant/actions')
    expect((await listAssistantChats(PROJECT, EPISODE)).status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// The ordering is real
// ---------------------------------------------------------------------------

describe('the higher roles are let through where the lower one is not', () => {
  it('a writer may mint a share link, and may not touch the project', async () => {
    asRole('writer')
    spies.issueShareLink.mockResolvedValue({ token: 'abc', role: 'writer' })
    const { issueShareLink } = await import('../lib/share/actions')
    expect((await issueShareLink(PROJECT, 'writer')).status).toBe('issued')

    const { archiveProjects } = await import('../lib/projects/actions')
    const form = new FormData()
    form.set('projectId', PROJECT)
    expect(await archiveProjects({ status: 'idle' }, form)).toMatchObject({ message: ROLE_REFUSED })
  })

  it('a writer may not delete an episode; an owner may', async () => {
    spies.listEpisodes.mockResolvedValue([
      { id: RECORD, slug: 'ep_001', ordinal: 1, title: 'One' },
      { id: PROJECT, slug: 'ep_002', ordinal: 2, title: 'Two' },
    ])
    const { deleteEpisode } = await import('../lib/workspace/actions')

    asRole('writer')
    expect(await deleteEpisode(PROJECT, EPISODE)).toEqual({ status: 'error', message: ROLE_REFUSED })
    expect(spies.removeEpisode).not.toHaveBeenCalled()

    asRole('owner')
    expect((await deleteEpisode(PROJECT, EPISODE)).status).toBe('done')
    expect(spies.removeEpisode).toHaveBeenCalledOnce()
  })
})
