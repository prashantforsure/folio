import type { ProjectScope } from '@folio/db'
import type { Derivation, DeriveError } from '@folio/script'
import { AsyncLocalStorage } from 'node:async_hooks'

import { rederiveProject } from './server'

/**
 * One derivation pass for a batch of writes, instead of one per write.
 *
 * ## What this is for
 *
 * A derivation pass reads every screenplay node in the project and rewrites
 * six derived tables (`rederiveProject`, `./server.ts`). Nineteen actions run
 * one, and for a person that is right: a writer merges two characters, waits,
 * and sees the queue and the counts that merge produced.
 *
 * An agent does not work that way. "Create the five characters in this scene"
 * is five `createCharacter` calls, and today that is five full passes over the
 * project to produce the state the fifth one leaves behind. The first four are
 * work whose only output is thrown away by the next one.
 *
 * So the pass becomes a **request**. Outside a batch a request is the pass,
 * run immediately, and nothing about the existing behaviour changes - that is
 * the property that matters, because every route in the app is outside a
 * batch. Inside one, the requests collapse and the pass runs once when the
 * batch closes.
 *
 * ## Why `AsyncLocalStorage` and not a parameter
 *
 * The alternative is threading a batch through nineteen actions and everything
 * they call, which makes every signature carry a concept only one caller has.
 * A request is scoped to the async context it was made in, which is what
 * `AsyncLocalStorage` is: the batch a `createCharacter` belongs to is the one
 * that called it, however deep the call went, and two batches running at once
 * in the same process cannot see each other's. That is also its limit - a
 * request made from a callback that escaped the batch's context is not in the
 * batch, and will run its own pass, which is the safe direction to fail in.
 *
 * ## What a caller inside a batch gives up
 *
 * The derived tables are stale until the batch closes, so an action that
 * answers with a derived count - `resolveCue`'s `pending`, the record lists -
 * answers with the count from before its own write. That is the cost of the
 * collapse and it is why this is opt-in rather than the default: a person
 * watching a screen must not be told a number that is one write out of date,
 * and an agent that will read the project again at the end of its turn is not
 * hurt by it.
 */

type Batch = { requested: boolean }

const batches = new AsyncLocalStorage<Batch>()

/**
 * The pass, or - inside a batch - the promise of one. `derivation` is `null`
 * when the pass has been deferred; `ok` is still true, because nothing failed.
 */
export type RederiveOutcome =
  | { readonly ok: true; readonly derivation: Derivation | null }
  | { readonly ok: false; readonly error: DeriveError | { readonly kind: 'unreadable' } }

/**
 * Ask for the project to be re-derived. **This is what an action calls.**
 *
 * Outside a batch this *is* `rederiveProject`, awaited, with the same result -
 * the call site reads identically and so does the behaviour.
 */
export const requestRederive = async (scope: ProjectScope): Promise<RederiveOutcome> => {
  const batch = batches.getStore()
  if (batch === undefined) return rederiveProject(scope)
  batch.requested = true
  return { ok: true, derivation: null }
}

/**
 * Run `work` as one batch: every re-derive it asks for becomes one pass at the
 * end, and none at all if it asked for none.
 *
 * Returns the work's own value and the pass's outcome beside it, rather than
 * swallowing the second: the writes inside have already answered by the time
 * the pass runs, so a failed pass has nowhere else to be reported.
 */
export const withDeferredDerive = async <T>(
  scope: ProjectScope,
  work: () => Promise<T>,
): Promise<{ readonly value: T; readonly derived: RederiveOutcome | null }> => {
  const batch: Batch = { requested: false }
  const value = await batches.run(batch, work)
  if (!batch.requested) return { value, derived: null }
  return { value, derived: await rederiveProject(scope) }
}

/** Whether this call is inside a batch. For a caller deciding what to report. */
export const inDeriveBatch = (): boolean => batches.getStore() !== undefined
