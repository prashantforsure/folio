import Anthropic from '@anthropic-ai/sdk'

import { assistantClient } from './client'
import { ASSISTANT_MODEL } from './model'

/**
 * Whether the model `model.ts` names exists for this key - one call to the
 * Models API (`GET /v1/models/{id}`), before a deploy (pre-deploy fixes,
 * 2026-09-24). The id is written once, by hand, and a typo or a retired model
 * would otherwise surface as the first writer's turn failing.
 *
 * The key is read where it always is: `assistantClient()` over `assistantEnv`
 * (`@folio/db/env`). The worker's `scripts/check-model.ts` prints the answer.
 */

export type ModelCheck =
  | { readonly status: 'found'; readonly model: string; readonly displayName: string; readonly createdAt: string }
  /** The API answered 404: no such model for this key. */
  | { readonly status: 'not-found'; readonly model: string }
  /** No `ANTHROPIC_API_KEY`: nothing was asked. */
  | { readonly status: 'not-connected' }
  /** The question could not be answered - a refused key, a network failure, a 5xx. Says nothing about the model. */
  | { readonly status: 'error'; readonly model: string; readonly message: string }

/** The slice of the SDK's `models` this reads - the SDK's own satisfies it, and a test can hand it a stand-in. */
export type ModelsReader = {
  readonly retrieve: (model: string) => PromiseLike<{ readonly id: string; readonly display_name: string; readonly created_at: string }>
}

export const checkModel = async (models: ModelsReader | null, model: string): Promise<ModelCheck> => {
  if (models === null) return { status: 'not-connected' }
  try {
    const info = await models.retrieve(model)
    return { status: 'found', model: info.id, displayName: info.display_name, createdAt: info.created_at }
  } catch (cause) {
    if (cause instanceof Anthropic.NotFoundError) return { status: 'not-found', model }
    if (cause instanceof Anthropic.AuthenticationError) return { status: 'error', model, message: 'The API key was refused (401).' }
    if (cause instanceof Anthropic.APIError) return { status: 'error', model, message: `The Models API answered ${String(cause.status ?? 'without a status')}: ${cause.message}` }
    return { status: 'error', model, message: cause instanceof Error ? cause.message : String(cause) }
  }
}

/** The check for the assistant's own model, with the assistant's own client. */
export const checkAssistantModel = (): Promise<ModelCheck> => checkModel(assistantClient()?.models ?? null, ASSISTANT_MODEL)

/** The check as one line for a person, and the exit code a script ends with. */
export const modelCheckReport = (check: ModelCheck): { readonly line: string; readonly exitCode: number } => {
  switch (check.status) {
    case 'found':
      return { line: `${check.model} exists: ${check.displayName}, released ${check.createdAt}.`, exitCode: 0 }
    case 'not-found':
      return { line: `${check.model} does not exist for this key (404). Change ASSISTANT_MODEL in apps/web/lib/assistant/model.ts.`, exitCode: 1 }
    case 'not-connected':
      return { line: 'ANTHROPIC_API_KEY is not set, so nothing was checked.', exitCode: 2 }
    case 'error':
      return { line: `Could not check ${check.model}: ${check.message}`, exitCode: 1 }
  }
}
