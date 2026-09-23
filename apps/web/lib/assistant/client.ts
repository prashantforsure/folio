import { assistantEnv } from '@folio/db/env'
import Anthropic from '@anthropic-ai/sdk'

import type { ModelClient } from '../agent/loop'

/**
 * The one door to the Anthropic SDK. Server only - this file holds the API
 * key's reader.
 *
 * `assistantConnected()` is what the shell tells the panel: unset key, no
 * composer. `assistantClient()` is the SDK client; the key itself never leaves
 * here. Out of `server.ts` since roadmap task 4.4, because the worker runs
 * background turns too and must not import `next/server`.
 */

export const assistantConnected = (): boolean => assistantEnv !== null

let client: Anthropic | null = null

/** The SDK client, or null with no key. The only reader of `ANTHROPIC_API_KEY` after `env.ts`. */
export const assistantClient = (): Anthropic | null => {
  const env = assistantEnv
  if (env === null) return null
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return client
}

/** The SDK narrowed to what the agent loop streams through (`loop.ts`). */
export const modelClientOf = (anthropic: Anthropic): ModelClient => ({ stream: (params, options) => anthropic.messages.stream(params, options) })
