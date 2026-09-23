// @vitest-environment node
import type { Episode, Project } from '@folio/contracts'
import { episodeId, episodeSlug, projectId, userId } from '@folio/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The gates, as a known person - roadmap task 4.2, ADR 0003 D4.
 *
 * `openProjectAs` / `openEpisodeAs` are the checks the cookie gates always
 * made, minus the cookie: the worker opens them with a run's starter. What is
 * held here is that they refuse exactly as the cookie gates do (the same words
 * for a stranger and a missing project, the role refusal for a member below
 * the minimum), that the cookie gates are now identity plus these, that a
 * worker's gate comes over the session pooler, and the two helpers the tools
 * use: narrowing a gate to another episode, and asking whether its person is
 * still a member.
 */

const spies = vi.hoisted(() => ({
  identity: vi.fn(),
  membership: vi.fn(),
  project: vi.fn(),
  episode: vi.fn(),
  transaction: vi.fn(),
  session: vi.fn(),
  forRequest: vi.fn(),
  forWorker: vi.fn(),
}))

vi.mock('../lib/auth/session', () => ({ currentIdentity: () => spies.identity() }))
vi.mock('@folio/db', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  readMembershipFor: (...args: readonly unknown[]) => spies.membership(...args),
  readProject: (...args: readonly unknown[]) => spies.project(...args),
  readEpisodeBySlug: (...args: readonly unknown[]) => spies.episode(...args),
  transactionDatabase: () => spies.transaction(),
  sessionDatabase: () => spies.session(),
  openProjectForRequest: (...args: readonly unknown[]) => spies.forRequest(...args),
  openProjectForWorker: (...args: readonly unknown[]) => spies.forWorker(...args),
}))

const { episodeGateOf, openEpisodeAs, openEpisodeAsWith, openProjectAs, roleRefusal, stillMember } = await import('../lib/script/actor-gate')
const { openEpisode, openProject } = await import('../lib/script/gate')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const ACTOR = userId('7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b')
const PROJECT_ROW = { id: PROJECT, kind: 'screenwriting', projectType: 'series' } as Project
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const OTHER_EPISODE = { ...EPISODE, id: episodeId('2d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), ordinal: 2, slug: episodeSlug('ep_002') } as Episode
const REQUEST_SCOPE = { pooler: 'transaction' }
const WORKER_SCOPE = { pooler: 'session' }

const REFUSED = { status: 'refused', message: 'That script could not be found.' }
const ROLE_REFUSED = { status: 'refused', message: "Your role on this project doesn't allow that." }

beforeEach(() => {
  vi.clearAllMocks()
  spies.identity.mockResolvedValue({ id: ACTOR })
  spies.membership.mockResolvedValue({ role: 'writer' })
  spies.project.mockResolvedValue(PROJECT_ROW)
  spies.episode.mockImplementation((_scope: unknown, slug: unknown) => Promise.resolve(slug === 'ep_001' ? EPISODE : slug === 'ep_002' ? OTHER_EPISODE : null))
  spies.transaction.mockResolvedValue({ db: 'transaction' })
  spies.session.mockResolvedValue({ db: 'session' })
  spies.forRequest.mockResolvedValue(REQUEST_SCOPE)
  spies.forWorker.mockResolvedValue(WORKER_SCOPE)
})

describe('openEpisodeAs', () => {
  it('opens the gate for a member, carrying their role, with no cookie read', async () => {
    const gate = await openEpisodeAs(ACTOR, PROJECT, 'ep_001', 'writer')
    expect(gate).toEqual({ actor: ACTOR, scope: REQUEST_SCOPE, project: PROJECT_ROW, episode: EPISODE, role: 'writer' })
    expect(spies.identity).not.toHaveBeenCalled()
    expect(spies.membership).toHaveBeenCalledWith({ db: 'transaction' }, ACTOR, PROJECT)
  })

  it('refuses a stranger, a missing project, a filmmaking project and a missing episode with the same words', async () => {
    spies.membership.mockResolvedValueOnce(null)
    expect(await openEpisodeAs(ACTOR, PROJECT, 'ep_001')).toEqual(REFUSED)
    spies.project.mockResolvedValueOnce(null)
    expect(await openEpisodeAs(ACTOR, PROJECT, 'ep_001')).toEqual(REFUSED)
    spies.project.mockResolvedValueOnce({ ...PROJECT_ROW, kind: 'filmmaking' })
    expect(await openEpisodeAs(ACTOR, PROJECT, 'ep_001')).toEqual(REFUSED)
    expect(await openEpisodeAs(ACTOR, PROJECT, 'ep_009')).toEqual(REFUSED)
  })

  it('refuses segments that do not parse before reading anything', async () => {
    expect(await openEpisodeAs(ACTOR, 'not-a-project', 'ep_001')).toEqual(REFUSED)
    expect(await openEpisodeAs(ACTOR, PROJECT, 'characters')).toEqual(REFUSED)
    expect(spies.membership).not.toHaveBeenCalled()
  })

  it('refuses a member below the minimum role in words of its own', async () => {
    spies.membership.mockResolvedValue({ role: 'reader' })
    expect(await openEpisodeAs(ACTOR, PROJECT, 'ep_001', 'writer')).toEqual(ROLE_REFUSED)
    expect(await openEpisodeAs(ACTOR, PROJECT, 'ep_001', 'reader')).toMatchObject({ role: 'reader' })
  })

  it('opens a worker`s gate over the session pooler', async () => {
    const gate = await openEpisodeAs(ACTOR, PROJECT, 'ep_001', 'reader', 'session')
    expect(gate).toMatchObject({ scope: WORKER_SCOPE })
    expect(spies.forWorker).toHaveBeenCalledWith(PROJECT, ACTOR)
    expect(spies.forRequest).not.toHaveBeenCalled()
    expect(spies.membership).toHaveBeenCalledWith({ db: 'session' }, ACTOR, PROJECT)
  })

  it('reads alongside the gate, and drops what it read for somebody refused', async () => {
    const alongside = vi.fn().mockResolvedValue('extra')
    expect(await openEpisodeAsWith(ACTOR, PROJECT, 'ep_001', alongside)).toMatchObject({ extra: 'extra' })
    spies.membership.mockResolvedValueOnce(null)
    expect(await openEpisodeAsWith(ACTOR, PROJECT, 'ep_001', alongside)).toEqual(REFUSED)
  })
})

describe('openProjectAs', () => {
  it('opens and refuses as the project cookie gate does', async () => {
    expect(await openProjectAs(ACTOR, PROJECT, 'owner')).toEqual(ROLE_REFUSED)
    expect(await openProjectAs(ACTOR, PROJECT, 'writer')).toEqual({ actor: ACTOR, scope: REQUEST_SCOPE, project: PROJECT_ROW, role: 'writer' })
    spies.membership.mockResolvedValueOnce(null)
    expect(await openProjectAs(ACTOR, PROJECT)).toEqual(REFUSED)
  })
})

describe('the cookie gates are identity plus the actor gates', () => {
  it('open for the signed-in person exactly what the actor gate opens', async () => {
    expect(await openEpisode(PROJECT, 'ep_001', 'writer')).toEqual(await openEpisodeAs(ACTOR, PROJECT, 'ep_001', 'writer'))
    expect(await openProject(PROJECT, 'writer')).toEqual(await openProjectAs(ACTOR, PROJECT, 'writer'))
  })

  it('refuse somebody signed out before reading anything else', async () => {
    spies.identity.mockResolvedValue(null)
    expect(await openEpisode(PROJECT, 'ep_001')).toEqual({ status: 'refused', message: 'Sign in to keep writing.' })
    expect(await openProject(PROJECT)).toEqual({ status: 'refused', message: 'Sign in to keep writing.' })
    expect(spies.membership).not.toHaveBeenCalled()
  })

  it('still refuse a malformed project id before asking who is signed in', async () => {
    expect(await openProject('nope')).toEqual(REFUSED)
    expect(await openEpisode('nope', 'ep_001')).toEqual(REFUSED)
    expect(spies.identity).not.toHaveBeenCalled()
  })
})

describe('the helpers a tool uses', () => {
  const gate = { actor: ACTOR, scope: REQUEST_SCOPE, project: PROJECT_ROW, episode: EPISODE, role: 'writer' as const } as Parameters<typeof episodeGateOf>[0] & { episode: Episode }

  it('narrows a gate to another episode of its project with one read, and refuses one that is not there', async () => {
    expect(await episodeGateOf(gate, 'ep_002')).toEqual({ ...gate, episode: OTHER_EPISODE })
    expect(await episodeGateOf(gate, 'ep_009')).toEqual(REFUSED)
    expect(await episodeGateOf(gate, 'not an episode')).toEqual(REFUSED)
    expect(spies.membership).not.toHaveBeenCalled()
  })

  it('asks whether the gate`s person is still a member, over the gate`s own pooler', async () => {
    expect(await stillMember(gate)).toBeNull()
    spies.membership.mockResolvedValueOnce(null)
    expect(await stillMember(gate)).toEqual(REFUSED)
    await stillMember({ ...gate, scope: WORKER_SCOPE } as typeof gate)
    expect(spies.membership).toHaveBeenLastCalledWith({ db: 'session' }, ACTOR, PROJECT)
  })

  it('answers a core function`s own role check with the gate`s words', () => {
    expect(roleRefusal({ role: 'reader' }, 'writer')).toEqual(ROLE_REFUSED)
    expect(roleRefusal({ role: 'owner' }, 'writer')).toBeNull()
  })
})
