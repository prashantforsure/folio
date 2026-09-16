/**
 * The assistant's model, written once.
 *
 * Not an environment variable: which model reads a writer's draft is a
 * product decision, and a setting is how it drifts between deployments.
 * `claude-opus-5` - the current Opus, the default the API reference names.
 * Changing it is a one-line commit with a reason.
 *
 * `MAX_OUTPUT_TOKENS` is the streaming ceiling. Streaming is the only way
 * this is ever called, so the number is a safety stop, not a budget.
 */
export const ASSISTANT_MODEL = 'claude-opus-5'

export const MAX_OUTPUT_TOKENS = 16_000

/**
 * The script as sent to the model is capped by characters, not tokens, so
 * the cap can be computed without a call: 400k characters is roughly a
 * feature and a half and well inside the model's window. A longer script is
 * cut at a scene boundary and the system prompt says so.
 */
export const CONTEXT_CHAR_CAP = 400_000
