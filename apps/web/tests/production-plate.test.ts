// @vitest-environment node
import type { ArtStyle, EpisodeSettings } from '@folio/contracts'
import { artStyleId, episodeId, productionGenerationId, projectId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A location's plate - roadmap task 5.1, the client's ruling (2026-09-24):
 * a shoot needs the location's photo, and a location without one can have a
 * plate drawn from its description. The runner stores it as the photo, the
 * way an upload is stored; it never draws over a photo, not even one the
 * writer uploaded while it drew.
 */

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  generateImage: vi.fn(),
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['resumeGeneration', 'succeedGeneration', 'failGeneration', 'refuseGeneration', 'setLocationPhotoKey']
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})
vi.mock('../lib/storage/r2', () => ({ putObject: (...args: readonly unknown[]) => spies.putObject(...args), deleteObject: (...args: readonly unknown[]) => spies.deleteObject(...args) }))
vi.mock('../lib/production/pipeline/gemini', () => ({ generateImage: (...args: readonly unknown[]) => spies.generateImage(...args), generateText: vi.fn(), generateVideo: vi.fn() }))

const { runGeneration } = await import('../lib/production/pipeline/runner')
const { locationPlateSpec } = await import('../lib/production/pipeline/spec')

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const SCOPE = { projectId: PROJECT } as ProjectScope
const ID = productionGenerationId('2a000000-0000-4000-8000-000000000001')
const LOCATION = 'd0000000-0000-4000-8000-000000000001'
const SETTINGS: EpisodeSettings = { episodeId: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), aspectRatio: '16:9 landscape', productionType: 'Narrative', cameraStyle: 'Academy', pacing: 'Balanced', lighting: 'Motivated', artStyleId: artStyleId('b1000000-0000-4000-8000-000000000001'), lockedAt: null }
const STYLE: ArtStyle = { id: artStyleId('b1000000-0000-4000-8000-000000000001'), key: 'netflix-prestige-drama', name: 'Netflix Prestige Drama', era: '2010s', referenceFilms: ['The Crown'], description: 'Restrained.', plateGradient: '', isPreset: true }

const spec = locationPlateSpec({ id: LOCATION, name: 'Jetty', description: 'A timber jetty at low tide, gulls on the pilings.', address: 'Fort Kochi' }, SETTINGS, STYLE)

const run = () => runGeneration({ scope: SCOPE, id: ID, spec, reel: null, names: [], target: { type: 'location', id: LOCATION } })

beforeEach(() => {
  vi.clearAllMocks()
  spies.db['resumeGeneration']?.mockResolvedValue({ id: ID })
  spies.db['succeedGeneration']?.mockResolvedValue({ id: ID })
  spies.generateImage.mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([1]), mime: 'image/png' } })
  spies.putObject.mockResolvedValue({ ok: true })
})

describe('the plate spec', () => {
  it('draws the place from its description in the episode`s style, with nobody in it', () => {
    expect(spec.job).toBe('location_plate')
    expect(spec.prompt).toContain('Art style: Netflix Prestige Drama')
    expect(spec.prompt).toContain('A timber jetty at low tide, gulls on the pilings. Where: Fort Kochi.')
    expect(spec.prompt).toContain('no people')
    expect(spec.references).toEqual([])
  })
})

describe('running a plate', () => {
  it('stores it under the location, as an upload is, and points the photo at it once the row has succeeded', async () => {
    spies.db['setLocationPhotoKey']?.mockResolvedValue({ found: true, previous: null })
    await run()
    const key = spies.putObject.mock.calls[0]?.[0] as string
    expect(key).toMatch(new RegExp(`^projects/${PROJECT}/locations/${LOCATION}/photo-[0-9a-f-]+\\.png$`))
    expect(spies.db['succeedGeneration']).toHaveBeenCalledWith(SCOPE, ID, { job: 'location_plate' })
    expect(spies.db['setLocationPhotoKey']).toHaveBeenCalledWith(SCOPE, LOCATION, key)
    expect(spies.deleteObject).not.toHaveBeenCalled()
  })

  it('keeps a photo the writer uploaded while it drew, and throws the plate away', async () => {
    spies.db['setLocationPhotoKey']?.mockResolvedValue({ found: true, previous: `projects/${PROJECT}/locations/uploaded.png` })
    await run()
    const key = spies.putObject.mock.calls[0]?.[0] as string
    expect(spies.db['setLocationPhotoKey']).toHaveBeenLastCalledWith(SCOPE, LOCATION, `projects/${PROJECT}/locations/uploaded.png`)
    expect(spies.deleteObject).toHaveBeenCalledWith(key)
    expect(spies.deleteObject).not.toHaveBeenCalledWith(`projects/${PROJECT}/locations/uploaded.png`)
  })

  it('points nothing at a plate whose generation was cancelled while it drew', async () => {
    spies.db['succeedGeneration']?.mockResolvedValue(null)
    await run()
    expect(spies.db['setLocationPhotoKey']).not.toHaveBeenCalled()
    expect(spies.deleteObject).toHaveBeenCalledWith(spies.putObject.mock.calls[0]?.[0])
  })
})
