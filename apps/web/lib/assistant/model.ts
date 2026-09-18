/**
 * The assistant's model, written once.
 *
 * Not an environment variable: which model reads a writer's draft is a
 * product decision, and a setting is how it drifts between deployments.
 * `claude-opus-5` - the current Opus, the default the API reference names.
 * Changing it is a one-line commit with a reason.
 *
 * `MAX_OUTPUT_TOKENS` is the streaming ceiling. Streaming is the only way
 * the chat is ever called, so the number is a safety stop, not a budget.
 */
export const ASSISTANT_MODEL = 'claude-opus-5'

export const MAX_OUTPUT_TOKENS = 16_000

/**
 * The script as sent to the model is capped by characters, not tokens, so
 * the cap can be computed without a call: 400k characters is roughly a
 * feature and a half and well inside the model's window. A longer script is
 * cut at a scene boundary and the system prompt says so. In project scope
 * the cap is shared across the episodes (`context.ts`, `renderProject`).
 */
export const CONTEXT_CHAR_CAP = 400_000

/**
 * The Characters route's model actions (`lib/characters/model-actions.ts`):
 * the scenes one character is in, capped smaller than a chat's script
 * because they are one person's evidence, not the whole draft; a short
 * answer for a draft, a longer one for a list of findings; a timeout under
 * most platform proxies'; and at most eight findings per check, the
 * strongest first.
 */
export const EVIDENCE_CHAR_CAP = 160_000

export const DRAFT_MAX_TOKENS = 4_000

export const CHECK_MAX_TOKENS = 8_000

export const MODEL_ACTION_TIMEOUT_MS = 90_000

export const FINDINGS_MAX = 8

/** The longest draft a field takes: two or three sentences, cut at a sentence end past this. */
export const DRAFT_MAX_CHARS = 700
