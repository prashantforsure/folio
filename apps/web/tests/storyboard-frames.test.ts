// @vitest-environment node
import type { Episode, Project } from '@folio/contracts'
import { episodeId, episodeSlug, FRAME_GENERATION_COST, generationId, jobId, projectId, shotId, userId } from '@folio/contracts'
import type { ClaimedJob, ProjectScope } from '@folio/db'
import { nodeId } from '@folio/script'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Storyboard frames on the worker - roadmap task 4.3, defect 0.4 closed.
 *
 * `requestFrameWith` refuses a reader, a proposal, a server that cannot draw
 * and a caller over the generate limit, and otherwise reserves and queues in
 * one call; the frame handler draws the shot with the `shot_frame` model from
 * the scene heading, the camera and the description with its mentions as
 * names and the mentioned characters' portraits, stores the image under the
 * shot, and settles the job the jobs table's way - drawn, failed (refunded),
 * refused, cancelled. The database, the model and the bucket are mocked.
 */

type Spy = Mock<(...args: readonly unknown[]) => unknown>

const spies = vi.hoisted(() => ({
  db: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
  connected: vi.fn(),
  checkRateLimit: vi.fn(),
  generateImage: vi.fn(),
  storage: {} as Record<string, Mock<(...args: readonly unknown[]) => unknown>>,
}))

vi.mock('@folio/db', async (actual) => {
  const real = await actual<Record<string, unknown>>()
  const names = ['queueFrameGeneration', 'openProjectForWorker', 'readFrameJob', 'readShot', 'listSceneIndex', 'readMentionLabels', 'listCharacterRecords', 'settleFrameJob']
  for (const name of names) spies.db[name] = vi.fn()
  return { ...real, ...Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.db[name]?.(...args)])) }
})
vi.mock('../lib/production/pipeline/connection', () => ({ connected: (...args: readonly unknown[]) => spies.connected(...args) }))
vi.mock('../lib/agent/rate-limit', () => ({ checkRateLimit: (...args: readonly unknown[]) => spies.checkRateLimit(...args) }))
vi.mock('../lib/production/pipeline/gemini', () => ({ generateImage: (...args: readonly unknown[]) => spies.generateImage(...args) }))
vi.mock('../lib/storage/r2', () => {
  const names = ['putObject', 'publicUrl', 'storageAvailable']
  for (const name of names) spies.storage[name] = vi.fn()
  return Object.fromEntries(names.map((name) => [name, (...args: readonly unknown[]) => spies.storage[name]?.(...args)]))
})

const { requestFrameWith, frameDrawingOff } = await import('../lib/storyboard/core')
const { frameGenerationHandler, cameraOf, proseOf } = await import('../lib/worker/frame-generation')

const db = (name: string): Spy => {
  const spy = spies.db[name]
  if (spy === undefined) throw new Error(`no spy ${name}`)
  return spy
}
const storage = (name: string): Spy => {
  const spy = spies.storage[name]
  if (spy === undefined) throw new Error(`no spy ${name}`)
  return spy
}

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')
const WRITER = userId('7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b')
const EPISODE = { id: episodeId('1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a'), projectId: PROJECT, ordinal: 1, slug: episodeSlug('ep_001'), title: 'Pilot' } as Episode
const SHOT = shotId('20000000-0000-4000-8000-000000000001')
const JOB = jobId('20000000-0000-4000-8000-000000000002')
const SCENE = nodeId('50000000-0000-4000-8000-000000000001')
const MEERA = '30000000-0000-4000-8000-000000000001'
const RAVI = '30000000-0000-4000-8000-000000000002'
const SCOPE = { projectId: PROJECT } as ProjectScope

const gate = (role: 'reader' | 'writer' | 'owner' = 'writer') => ({
  actor: WRITER,
  scope: SCOPE,
  project: { id: PROJECT, format: 'hollywood', projectType: 'film' } as Project,
  episode: EPISODE,
  role,
})

const claimed = (): ClaimedJob => ({ id: JOB, projectId: PROJECT, kind: 'frame_generation', payload: {}, createdBy: WRITER, attempts: 1, cost: FRAME_GENERATION_COST, lease: 'lease' })

const shot = (over: Record<string, unknown> = {}) => ({
  id: SHOT,
  projectId: PROJECT,
  sceneNodeId: SCENE,
  state: 'accepted',
  size: 'mcu',
  angle: 'eye_level',
  movement: 'static',
  lensMm: 50,
  durationSeconds: null,
  description: [
    { kind: 'mention', target: { entity: 'character', id: MEERA } },
    { kind: 'text', text: ' reads the chart at the ' },
    { kind: 'mention', target: { entity: 'location', id: '40000000-0000-4000-8000-000000000001' } },
    { kind: 'text', text: ' desk.' },
  ],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  spies.connected.mockReturnValue(null)
  spies.checkRateLimit.mockResolvedValue(null)
  db('openProjectForWorker').mockResolvedValue(SCOPE)
  db('readFrameJob').mockResolvedValue({ jobId: JOB, generationId: generationId('20000000-0000-4000-8000-000000000003'), shotId: SHOT, cost: FRAME_GENERATION_COST, status: 'running', frameUrl: null })
  db('readShot').mockResolvedValue(shot())
  db('listSceneIndex').mockResolvedValue([{ sceneNodeId: SCENE, heading: 'INT. WARD - NIGHT' }])
  db('readMentionLabels').mockResolvedValue([
    { entity: 'character', id: MEERA, label: 'Meera' },
    { entity: 'location', id: '40000000-0000-4000-8000-000000000001', label: 'nurses’ station' },
  ])
  db('listCharacterRecords').mockResolvedValue([
    { id: MEERA, name: 'Meera', portraitKey: 'portraits/meera.png' },
    { id: RAVI, name: 'Ravi', portraitKey: 'portraits/ravi.png' },
  ])
  db('settleFrameJob').mockResolvedValue(undefined)
  storage('publicUrl').mockImplementation((key: unknown) => (key === null ? null : `https://r2.example/${String(key)}`))
  storage('putObject').mockResolvedValue({ ok: true })
  spies.generateImage.mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } })
})

// ---------------------------------------------------------------------------
// requestFrame
// ---------------------------------------------------------------------------

describe('requestFrameWith', () => {
  it('reserves and queues, and answers the queued frame with the balance after the reservation', async () => {
    db('queueFrameGeneration').mockResolvedValue({ status: 'queued', jobId: JOB, generationId: 'g', available: 16 })
    const result = await requestFrameWith(gate(), SHOT)
    expect(db('queueFrameGeneration')).toHaveBeenCalledWith(SCOPE, EPISODE.id, SHOT, FRAME_GENERATION_COST)
    expect(spies.checkRateLimit).toHaveBeenCalledWith(SCOPE, WRITER, 'generate')
    expect(result).toEqual({ status: 'queued', frame: { kind: 'queued', jobId: JOB, cost: FRAME_GENERATION_COST }, available: 16 })
  })

  it('refuses a reader before anything is read', async () => {
    const result = await requestFrameWith(gate('reader'), SHOT)
    expect(result.status).toBe('refused')
    expect(db('queueFrameGeneration')).not.toHaveBeenCalled()
  })

  it('refuses with the reason when this server cannot draw, and reserves nothing', async () => {
    spies.connected.mockReturnValue({ status: 'disconnected', message: 'The model is not connected: set GEMINI_API_KEY on this server.' })
    expect(frameDrawingOff()).toBe('The model is not connected: set GEMINI_API_KEY on this server.')
    expect(await requestFrameWith(gate(), SHOT)).toEqual({ status: 'refused', message: 'The model is not connected: set GEMINI_API_KEY on this server.' })
    expect(spies.connected).toHaveBeenCalledWith('shot_frame')
    expect(db('queueFrameGeneration')).not.toHaveBeenCalled()
  })

  it('answers the generate limit, and a short balance with both numbers', async () => {
    spies.checkRateLimit.mockResolvedValueOnce({ status: 'rate-limited', message: 'Slow down.', retryAfterSeconds: 60 })
    expect((await requestFrameWith(gate(), SHOT)).status).toBe('rate-limited')
    expect(db('queueFrameGeneration')).not.toHaveBeenCalled()

    db('queueFrameGeneration').mockResolvedValue({ status: 'insufficient', available: 2 })
    expect(await requestFrameWith(gate(), SHOT)).toEqual({ status: 'insufficient', available: 2, cost: FRAME_GENERATION_COST })
  })

  it('says a proposal has no frame, and refuses an id that is not a shot', async () => {
    db('queueFrameGeneration').mockResolvedValue({ status: 'no-shot', state: 'proposed' })
    expect(await requestFrameWith(gate(), SHOT)).toEqual({ status: 'error', message: 'Accept the shot before drawing its frame. A proposal has no frame.' })
    expect((await requestFrameWith(gate(), 'not-a-shot')).status).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// The frame handler
// ---------------------------------------------------------------------------

describe('frameGenerationHandler', () => {
  it('draws the shot from its scene, camera and description, stores it under the shot, and settles drawn', async () => {
    const outcome = await frameGenerationHandler.run({ job: claimed(), signal: new AbortController().signal })

    expect(db('openProjectForWorker')).toHaveBeenCalledWith(PROJECT, WRITER)
    const [route, spec] = spies.generateImage.mock.calls[0] as [string, { readonly prompt: string; readonly references: readonly unknown[]; readonly aspect: string }]
    expect(route.length).toBeGreaterThan(0)
    expect(spec.aspect).toBe('16:9')
    expect(spec.prompt).toContain('Scene: INT. WARD - NIGHT.')
    expect(spec.prompt).toContain('Camera: medium close-up · eye level angle · static · 50mm.')
    expect(spec.prompt).toContain('Action: Meera reads the chart at the nurses’ station desk.')
    // Only the characters the description mentions lend their portraits.
    expect(spec.references).toEqual([{ role: 'character', label: 'Meera', url: 'https://r2.example/portraits/meera.png' }])

    const [key, bytes, mime] = storage('putObject').mock.calls[0] as [string, Uint8Array, string]
    expect(key).toMatch(new RegExp(`^projects/${PROJECT}/shots/${SHOT}/generated-[0-9a-f-]{36}\\.png$`))
    expect([...bytes]).toEqual([1, 2, 3])
    expect(mime).toBe('image/png')
    expect(db('settleFrameJob')).toHaveBeenCalledWith(SCOPE, JOB, { kind: 'drawn', frameUrl: `https://r2.example/${key}` })
    expect(outcome).toEqual({ status: 'finished' })
  })

  it('settles a refusal as blocked (released) and a failure as failed (refunded)', async () => {
    spies.generateImage.mockResolvedValueOnce({ ok: false, kind: 'refused', reason: 'Flagged.' })
    expect(await frameGenerationHandler.run({ job: claimed(), signal: new AbortController().signal })).toEqual({ status: 'blocked', reason: 'Flagged.' })
    expect(db('settleFrameJob')).toHaveBeenLastCalledWith(SCOPE, JOB, { kind: 'blocked', reason: 'Flagged.' })

    spies.generateImage.mockResolvedValueOnce({ ok: false, kind: 'failed', message: '503 Service Unavailable' })
    expect(await frameGenerationHandler.run({ job: claimed(), signal: new AbortController().signal })).toEqual({ status: 'failed', error: '503 Service Unavailable' })
    expect(db('settleFrameJob')).toHaveBeenLastCalledWith(SCOPE, JOB, { kind: 'failed', error: '503 Service Unavailable' })

    storage('putObject').mockResolvedValueOnce({ ok: false, message: 'Storage refused the upload (500).' })
    expect(await frameGenerationHandler.run({ job: claimed(), signal: new AbortController().signal })).toEqual({ status: 'failed', error: 'Storage refused the upload (500).' })
  })

  it('fails, and so refunds, a job whose shot is gone or is a proposal - the old queued jobs on dev', async () => {
    db('readShot').mockResolvedValueOnce(null)
    expect(await frameGenerationHandler.run({ job: claimed(), signal: new AbortController().signal })).toEqual({ status: 'failed', error: 'The shot is gone.' })
    db('readShot').mockResolvedValueOnce(shot({ state: 'proposed' }))
    expect(await frameGenerationHandler.run({ job: claimed(), signal: new AbortController().signal })).toEqual({ status: 'failed', error: 'A proposal has no frame.' })
    expect(spies.generateImage).not.toHaveBeenCalled()
  })

  it('does not draw again after a crash that followed the settle', async () => {
    db('readFrameJob').mockResolvedValueOnce({ jobId: JOB, generationId: 'g', shotId: SHOT, cost: 4, status: 'running', frameUrl: 'https://r2.example/done.png' })
    expect(await frameGenerationHandler.run({ job: claimed(), signal: new AbortController().signal })).toEqual({ status: 'finished' })
    expect(spies.generateImage).not.toHaveBeenCalled()
    expect(db('settleFrameJob')).toHaveBeenCalledWith(SCOPE, JOB, { kind: 'drawn', frameUrl: 'https://r2.example/done.png' })
  })

  it('settles cancelled when the writer stops it mid-drawing, and keeps drawing through a shutdown', async () => {
    const controller = new AbortController()
    spies.generateImage.mockImplementationOnce((_route: unknown, _spec: unknown, signal: AbortSignal) => {
      controller.abort('cancel')
      return Promise.resolve(signal.aborted ? { ok: false, kind: 'failed', message: 'This operation was aborted' } : { ok: true, value: { bytes: new Uint8Array([1]), mime: 'image/png' } })
    })
    expect(await frameGenerationHandler.run({ job: claimed(), signal: controller.signal })).toEqual({ status: 'cancelled' })
    expect(db('settleFrameJob')).toHaveBeenLastCalledWith(SCOPE, JOB, { kind: 'cancelled' })
    expect(storage('putObject')).not.toHaveBeenCalled()

    const shutdown = new AbortController()
    spies.generateImage.mockImplementationOnce((_route: unknown, _spec: unknown, signal: AbortSignal) => {
      shutdown.abort('shutdown')
      return Promise.resolve(signal.aborted ? { ok: false, kind: 'failed', message: 'aborted' } : { ok: true, value: { bytes: new Uint8Array([1]), mime: 'image/png' } })
    })
    expect(await frameGenerationHandler.run({ job: claimed(), signal: shutdown.signal })).toEqual({ status: 'finished' })
  })

  it('refunds the frame as interrupted when the stale sweep abandons it', async () => {
    await frameGenerationHandler.abandon?.(claimed(), 'Stopped after 3 attempts without finishing.')
    expect(db('settleFrameJob')).toHaveBeenCalledWith(SCOPE, JOB, { kind: 'failed', error: 'interrupted' })
  })

  it('prints the camera and the description as the board reads them', () => {
    expect(cameraOf({ size: 'ews', angle: 'low', movement: 'dolly', lensMm: null })).toBe('extreme wide shot · low angle · dolly')
    expect(proseOf([{ kind: 'mention', target: { entity: 'character', id: RAVI as never } }, { kind: 'text', text: ' waits.' }], [])).toBe(' waits.')
  })
})
