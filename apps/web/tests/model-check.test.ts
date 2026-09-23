// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'

import type { ModelsReader } from '../lib/assistant/model-check'

/**
 * The pre-deploy model check (`lib/assistant/model-check.ts`): one Models API
 * call for the id `model.ts` names. The SDK's `models` is a stand-in; the
 * errors are the SDK's own classes, so the narrowing is the real one.
 */

vi.mock('@folio/db/env', () => ({ assistantEnv: null }))

const { checkAssistantModel, checkModel, modelCheckReport } = await import('../lib/assistant/model-check')
const { ASSISTANT_MODEL } = await import('../lib/assistant/model')

type ModelInfo = { readonly id: string; readonly display_name: string; readonly created_at: string }

const reader = (answer: () => Promise<ModelInfo>) => {
  const retrieve = vi.fn((_model: string) => answer())
  const models: ModelsReader = { retrieve }
  return Object.assign(models, { retrieve })
}

describe('checkModel', () => {
  it('finds a model the API knows, asking for exactly the id it was given', async () => {
    const models = reader(() => Promise.resolve({ id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-05-01T00:00:00Z' }))
    expect(await checkModel(models, 'claude-opus-5')).toEqual({ status: 'found', model: 'claude-opus-5', displayName: 'Claude Opus 5', createdAt: '2026-05-01T00:00:00Z' })
    expect(models.retrieve).toHaveBeenCalledWith('claude-opus-5')
  })

  it('says a 404 is a model that does not exist', async () => {
    const models = reader(() => Promise.reject(new Anthropic.NotFoundError(404, { type: 'error' }, 'model: claude-opus-9', new Headers())))
    expect(await checkModel(models, 'claude-opus-9')).toEqual({ status: 'not-found', model: 'claude-opus-9' })
  })

  it('does not call a refused key or an outage a missing model', async () => {
    const refused = reader(() => Promise.reject(new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers())))
    expect(await checkModel(refused, 'claude-opus-5')).toEqual({ status: 'error', model: 'claude-opus-5', message: 'The API key was refused (401).' })
    const down = reader(() => Promise.reject(new Anthropic.InternalServerError(500, { type: 'error' }, 'overloaded', new Headers())))
    expect(await checkModel(down, 'claude-opus-5')).toMatchObject({ status: 'error', message: expect.stringContaining('500') })
    const offline = reader(() => Promise.reject(new Error('getaddrinfo ENOTFOUND api.anthropic.com')))
    expect(await checkModel(offline, 'claude-opus-5')).toMatchObject({ status: 'error', message: 'getaddrinfo ENOTFOUND api.anthropic.com' })
  })

  it('asks nothing without a key', async () => {
    expect(await checkModel(null, 'claude-opus-5')).toEqual({ status: 'not-connected' })
    // The assistant's own check reads the key through `assistantEnv`, unset here.
    expect(await checkAssistantModel()).toEqual({ status: 'not-connected' })
  })
})

describe('modelCheckReport', () => {
  it('prints one line and an exit code a deploy script can act on', () => {
    expect(modelCheckReport({ status: 'found', model: ASSISTANT_MODEL, displayName: 'Claude Opus 5', createdAt: '2026-05-01T00:00:00Z' })).toEqual({
      line: `${ASSISTANT_MODEL} exists: Claude Opus 5, released 2026-05-01T00:00:00Z.`,
      exitCode: 0,
    })
    expect(modelCheckReport({ status: 'not-found', model: 'claude-opus-9' })).toMatchObject({ exitCode: 1, line: expect.stringContaining('apps/web/lib/assistant/model.ts') })
    expect(modelCheckReport({ status: 'not-connected' }).exitCode).toBe(2)
    expect(modelCheckReport({ status: 'error', model: 'claude-opus-5', message: 'The API key was refused (401).' })).toEqual({ line: 'Could not check claude-opus-5: The API key was refused (401).', exitCode: 1 })
  })
})
