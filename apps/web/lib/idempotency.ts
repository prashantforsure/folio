import { IdempotencyKeySchema } from '@folio/contracts'

/**
 * The optional last argument of every create action.
 *
 * A create is the one shape of write a retry cannot repeat safely: a save is
 * the same save twice and a delete is already gone, but a create called twice
 * makes two rows. Nine tables carry a nullable `idempotency_key` and a partial
 * unique index (migration `0031`); a caller that can be retried passes a key
 * and the second call gets the first call's row back.
 *
 * Nothing in the UI passes one, and that is the design rather than an
 * omission: a person clicking `＋ New character` twice means two characters.
 * The caller this exists for is the agent, whose `tool_use` id is the key
 * (ADR 0003 **D13**) - the API redelivers a tool call it did not see answered,
 * and without a key that is a second character with the same name.
 *
 * ## A malformed key refuses rather than being dropped
 *
 * Ignoring an unreadable key would silently remove the protection at exactly
 * the moment somebody was relying on it. Absent is fine and means "not
 * retryable"; present and unreadable is a caller error.
 */
export type KeyParse = { readonly ok: true; readonly key: string | null } | { readonly ok: false }

export const BAD_IDEMPOTENCY_KEY = 'That idempotency key could not be read.'

export const idempotencyKeyOf = (raw: unknown): KeyParse => {
  if (raw === null || raw === undefined) return { ok: true, key: null }
  const parsed = IdempotencyKeySchema.safeParse(raw)
  return parsed.success ? { ok: true, key: parsed.data } : { ok: false }
}
