import type { GenerationJob } from '@folio/contracts'
import { MODEL_REGISTRY } from '@folio/contracts'
import { modelEnv } from '@folio/db/env'

import { storageAvailable } from '../../storage/r2'
import type { Failure } from '../result'

/**
 * Whether this server can run a generation job at all - the check every
 * generate button draws disabled on and every generate action refuses with:
 * the model needs `GEMINI_API_KEY`, and anything that makes a file needs the
 * `R2_*` block. Production's generations and the Storyboard's frames
 * (roadmap task 4.3) ask the same question of the same registry.
 */

export const MODEL_OFF = 'The model is not connected: set GEMINI_API_KEY on this server.'
export const STORAGE_OFF = 'Image storage is not set up on this server yet - generated images have nowhere to go.'

export type Disconnected = { readonly status: 'disconnected'; readonly message: string }

export const connected = (job: GenerationJob): Failure | Disconnected | null => {
  const registry = MODEL_REGISTRY[job]
  if (registry === null) return null
  if (modelEnv === null) return { status: 'disconnected', message: MODEL_OFF }
  if (registry.kind !== 'text' && !storageAvailable()) return { status: 'disconnected', message: STORAGE_OFF }
  return null
}
