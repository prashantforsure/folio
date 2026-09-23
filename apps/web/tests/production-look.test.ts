// @vitest-environment node
import type { ArtStyle, Episode, EpisodeSettings, Project } from '@folio/contracts'
import { GENERATION_COSTS, artStyleId, episodeId, episodeSlug, productionGenerationId, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A character's look - roadmap task 5.2. The look is the portrait (the
 * client's ruling that the portrait is the appearance reference): drawn from
 * the record's appearance, age and gender in the **first episode's** art style
 * (ruled 2026-09-24), whichever episode asked, and stored with
 * `setPortraitKey` - the old portrait's object deleted only once nothing
 * points at it.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  generateImage: vi.fn(),
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = [
    'resumeGeneration',
    'succeedGeneration',
    'failGeneration',
    'refuseGeneration',
    'setPortraitKey',
    'listEpisodes',
    'readEpisodeBySlug',
    'touchRateLimit',
    'readProductionEpisode',
    'listCharacterRecords',
    'listLocationRecords',
    'readLiveGenerationFor',
    'createGeneration',
  ]
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})
vi.mock('../lib/storage/r2', () => ({
  putObject: (...args: readonly unknown[]) => spies.putObject(...args),
  deleteObject: (...args: readonly unknown[]) => spies.deleteObject(...args),
  publicUrl: (key: string | null) => (key === null ? null : `https://cdn.example/${key}`),
  storageAvailable: () => true,
}))
vi.mock('../lib/production/pipeline/gemini', () => ({ generateImage: (...args: readonly unknown[]) => spies.generateImage(...args), generateText: vi.fn(), generateVideo: vi.fn() }))
vi.mock('../lib/production/pipeline/connection', () => ({ connected: () => null }))

const { runGeneration } = await import('../lib/production/pipeline/runner')
const { characterLookSpec } = await import('../lib/production/pipeline/spec')
const { generateCharacterLookWith } = await import('../lib/production/generate-core')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const SCOPE = { projectId: PROJECT } as ProjectScope
const ID = productionGenerationId('2a000000-0000-4000-8000-000000000002')
const CHARACTER = 'e0000000-0000-4000-8000-000000000001'
const STYLE_ID = artStyleId('b1000000-0000-4000-8000-000000000001')
const SETTINGS: EpisodeSettings = { episodeId: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), aspectRatio: '16:9 landscape', productionType: 'Narrative', cameraStyle: 'Academy', pacing: 'Balanced', lighting: 'Motivated', artStyleId: STYLE_ID, lockedAt: null }
const STYLE: ArtStyle = { id: STYLE_ID, key: 'netflix-prestige-drama', name: 'Netflix Prestige Drama', era: '2010s', referenceFilms: ['The Crown'], description: 'Restrained.', plateGradient: '', isPreset: true }

const FIRST = { id: episodeId('11111111-1111-4111-8111-111111111111'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const SECOND = { id: episodeId('22222222-2222-4222-8222-222222222222'), projectId: PROJECT, ordinal: 2, slug: episodeSlug('ep_002'), title: 'Two' } as Episode

beforeEach(() => {
  vi.clearAllMocks()
  spies.db['resumeGeneration']?.mockResolvedValue({ id: ID })
  spies.db['succeedGeneration']?.mockResolvedValue({ id: ID })
  spies.generateImage.mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([1]), mime: 'image/png' } })
  spies.putObject.mockResolvedValue({ ok: true })
})

describe('the look spec', () => {
  const spec = characterLookSpec({ id: CHARACTER, name: 'MEERA', appearance: 'Salt-grey braid, a ferry ticket tucked behind one ear.', age: '52', gender: 'Female', role: 'The ferry captain', portraitUrl: 'https://cdn.example/old.png' }, SETTINGS, STYLE)

  it('draws the record`s appearance, age and gender in the episode`s style, as a portrait', () => {
    expect(spec.job).toBe('character_look')
    expect(spec.prompt).toContain('Art style: Netflix Prestige Drama')
    expect(spec.prompt).toContain('A character look for MEERA (age 52, Female), The ferry captain')
    expect(spec.prompt).toContain('Appearance: Salt-grey braid, a ferry ticket tucked behind one ear.')
    expect(spec.aspect).toBe('9:16')
  })

  it('keeps the likeness of a portrait it redraws: the portrait goes in as the character reference', () => {
    expect(spec.references).toEqual([{ role: 'character', label: 'MEERA', url: 'https://cdn.example/old.png' }])
  })
})

describe('running a look', () => {
  const run = () =>
    runGeneration({
      scope: SCOPE,
      id: ID,
      spec: characterLookSpec({ id: CHARACTER, name: 'MEERA', appearance: null, age: null, gender: null, role: null, portraitUrl: null }, SETTINGS, STYLE),
      reel: null,
      names: [],
      target: { type: 'character', id: CHARACTER },
    })

  it('stores it under the character and makes it the portrait, deleting the old portrait only after', async () => {
    spies.db['setPortraitKey']?.mockResolvedValue({ found: true, previous: `projects/${PROJECT}/characters/old.png` })
    await run()
    const key = spies.putObject.mock.calls[0]?.[0] as string
    expect(key).toMatch(new RegExp(`^projects/${PROJECT}/characters/${CHARACTER}/portrait-[0-9a-f-]+\\.png$`))
    expect(spies.db['succeedGeneration']).toHaveBeenCalledWith(SCOPE, ID, { job: 'character_look' })
    expect(spies.db['setPortraitKey']).toHaveBeenCalledWith(SCOPE, CHARACTER, key)
    expect(spies.deleteObject).toHaveBeenCalledWith(`projects/${PROJECT}/characters/old.png`)
    expect(spies.deleteObject).not.toHaveBeenCalledWith(key)
  })

  it('points nothing at a look whose generation was cancelled while it drew', async () => {
    spies.db['succeedGeneration']?.mockResolvedValue(null)
    await run()
    expect(spies.db['setPortraitKey']).not.toHaveBeenCalled()
    expect(spies.deleteObject).toHaveBeenCalledWith(spies.putObject.mock.calls[0]?.[0])
  })
})

describe('generateCharacterLookWith', () => {
  it('draws the look in the first episode, whichever episode asked, at the look`s price', async () => {
    spies.db['listEpisodes']?.mockResolvedValue([SECOND, FIRST])
    spies.db['readEpisodeBySlug']?.mockResolvedValue(FIRST)
    spies.db['touchRateLimit']?.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    spies.db['readProductionEpisode']?.mockResolvedValue({ scenes: [], reels: [], assets: new Map(), notes: new Map(), settings: SETTINGS, artStyles: [STYLE], live: [], preferences: null })
    spies.db['listCharacterRecords']?.mockResolvedValue([{ id: CHARACTER, name: 'MEERA', color: 'blue', gender: 'female', age: '52', role: null, bio: null, appearance: 'A salt-grey braid.', portraitKey: null }])
    spies.db['listLocationRecords']?.mockResolvedValue([])
    spies.db['readLiveGenerationFor']?.mockResolvedValue(null)
    spies.db['createGeneration']?.mockResolvedValue({ status: 'created', generation: { id: ID } })
    const asking = { actor: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b' as never, scope: SCOPE, project: { id: PROJECT } as Project, episode: SECOND, role: 'writer' as const }

    const result = await generateCharacterLookWith(asking, CHARACTER)

    expect(result).toEqual({ status: 'queued', generation: { id: ID } })
    expect(spies.db['readEpisodeBySlug']).toHaveBeenCalledWith(SCOPE, 'ep_001')
    const seed = spies.db['createGeneration']?.mock.calls[0]?.[1] as { episodeId: string; targetType: string; targetId: string; job: string; cost: number; prompt: { text: string } }
    expect(seed).toMatchObject({ episodeId: FIRST.id, targetType: 'character', targetId: CHARACTER, job: 'character_look', cost: GENERATION_COSTS.character_look })
    expect(seed.prompt.text).toContain('Appearance: A salt-grey braid.')
  })

  it('refuses a character that is not in the project, and starts nothing', async () => {
    spies.db['listEpisodes']?.mockResolvedValue([FIRST])
    spies.db['readEpisodeBySlug']?.mockResolvedValue(FIRST)
    spies.db['touchRateLimit']?.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    spies.db['readProductionEpisode']?.mockResolvedValue({ scenes: [], reels: [], assets: new Map(), notes: new Map(), settings: SETTINGS, artStyles: [STYLE], live: [], preferences: null })
    spies.db['listCharacterRecords']?.mockResolvedValue([])
    spies.db['listLocationRecords']?.mockResolvedValue([])
    const asking = { actor: 'u' as never, scope: SCOPE, project: { id: PROJECT } as Project, episode: FIRST, role: 'writer' as const }
    expect(await generateCharacterLookWith(asking, CHARACTER)).toEqual({ status: 'error', message: 'That character is not in this project.' })
    expect(spies.db['createGeneration']).not.toHaveBeenCalled()
  })
})
