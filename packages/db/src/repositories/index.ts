import type { ProjectId, UserId } from '@folio/contracts'

import { sessionDatabase, transactionDatabase } from '../client'
import { makeScope } from '../scope'
import type { ProjectScope } from '../scope'

/**
 * How a caller gets a scope, and the only two ways.
 *
 * `openProjectForRequest` for anything serving a web request; it goes through
 * the transaction pooler, with `prepare: false`, because Supabase's transaction
 * mode requires it.
 *
 * `openProjectForWorker` for a BullMQ consumer; it goes through the session
 * pooler, so prepared statements, advisory locks and `LISTEN` all work.
 *
 * AGENTS.md, Tech stack: "Session pooler for the worker, transaction pooler for
 * requests." Two functions rather than one with a mode argument, so choosing
 * the wrong one is a different call site rather than a wrong string.
 *
 * ## What these functions do not do
 *
 * **They do not check whether the actor may see the project.** That is a
 * server-side gate and it belongs in the server action - AGENTS.md, Development
 * philosophy 5: "The server enforces; the client discloses", and Feature
 * workflow step 7: "Every gate is enforced here - scope, allowlist, cost, bible
 * status, research readability, tenancy."
 *
 * That is a deliberate and slightly uncomfortable line, so it is written down:
 * this layer guarantees that a query **cannot cross projects**, not that the
 * caller was entitled to this one. RLS is the net underneath if the check is
 * ever missed - and because the server connects with the service-role key and
 * bypasses RLS, that net only catches a leak reached some other way. Neither
 * substitutes for the gate. Phase 6 owns it.
 */

export const openProjectForRequest = async (
  projectId: ProjectId,
  actor: UserId | null,
): Promise<ProjectScope<'transaction'>> => {
  const db = await transactionDatabase()
  return makeScope(db, 'transaction', projectId, actor)
}

export const openProjectForWorker = async (
  projectId: ProjectId,
  actor: UserId | null,
): Promise<ProjectScope<'session'>> => {
  const db = await sessionDatabase()
  return makeScope(db, 'session', projectId, actor)
}

export * from './projects'
export * from './documents'
export * from './threads'
export * from './history'
export * from './measurement'
export * from './derived'
export * from './derivation'
export * from './scenes'
export * from './beats'
export * from './entity-counts'
export * from './credits'
export * from './users'
export { proposalTargetKey } from './derived'
export type { NodeRowShape, NodeWrite } from './mapping'
export {
  nodeToWrite,
  outlineNodeFromRow,
  provenanceFromRow,
  screenplayNodeFromRow,
} from './mapping'
export * from './episode-slug'
export * from './workspace'
export * from './locked-pages'
