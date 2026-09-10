import type { Thread, ThreadAnchor, ThreadComment, ThreadId, UserId } from '@folio/contracts'
import { projectId as brandProjectId, threadId as brandThreadId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { asc, eq, isNull } from 'drizzle-orm'

import { commentThreads, threadComments } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp, stampOrNull } from './mapping'

/**
 * Comment threads and their messages.
 *
 * Anchoring is by id and only by id. AGENTS.md and `docs/adr/0001-node-identity.md`
 * both make the point: an anchor that moves "does not fail loudly - it silently
 * re-points a reviewer's comment at somebody else's line", and the system to
 * avoid is one that starts anchoring by text offset or by matching prose. There
 * is no offset here, no quoted text and no line number.
 */

type ThreadRow = typeof commentThreads.$inferSelect

/**
 * The row's two anchor columns become the union again.
 *
 * The database guarantees exactly one is set, by check constraint. The
 * `default` branch below is therefore unreachable for a row Postgres accepted -
 * it is here because the compiler cannot see the constraint, and throwing
 * beats silently producing a shot anchor with a node id in it.
 */
const toAnchor = (row: ThreadRow): ThreadAnchor => {
  if (row.anchorKind === 'storyboard_shot') {
    if (row.anchorShotId === null) {
      throw new Error(
        'Folio: a storyboard_shot thread has no shot id. The comment_threads_anchor_matches_kind constraint should have prevented this row.',
      )
    }
    return { kind: 'storyboard_shot', shotId: row.anchorShotId }
  }
  if (row.anchorNodeId === null) {
    throw new Error(
      `Folio: a ${row.anchorKind} thread has no node id. The comment_threads_anchor_matches_kind constraint should have prevented this row.`,
    )
  }
  return { kind: row.anchorKind, nodeId: row.anchorNodeId as NodeId }
}

const toThread = (row: ThreadRow): Thread => ({
  id: brandThreadId(row.id),
  projectId: brandProjectId(row.projectId),
  anchor: toAnchor(row),
  state: row.state,
  createdBy: row.createdBy as UserId,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
  resolvedAt: stampOrNull(row.resolvedAt),
  resolvedBy: row.resolvedBy === null ? null : (row.resolvedBy as UserId),
})

const toComment = (row: typeof threadComments.$inferSelect): ThreadComment => ({
  id: row.id as ThreadComment['id'],
  projectId: brandProjectId(row.projectId),
  threadId: brandThreadId(row.threadId),
  authorId: row.authorId as UserId,
  body: row.body,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
  editedAt: stampOrNull(row.editedAt),
})

/** The union, going the other way: which column each variant writes. */
const anchorColumns = (
  anchor: ThreadAnchor,
): { readonly anchorKind: ThreadAnchor['kind']; readonly anchorNodeId: string | null; readonly anchorShotId: string | null } =>
  anchor.kind === 'storyboard_shot'
    ? { anchorKind: anchor.kind, anchorNodeId: null, anchorShotId: anchor.shotId }
    : { anchorKind: anchor.kind, anchorNodeId: anchor.nodeId, anchorShotId: null }

export const openThread = async (
  scope: ProjectScope,
  anchor: ThreadAnchor,
  body: string,
): Promise<Thread> => {
  const author = scope.actor
  if (author === null) {
    throw new Error('Folio: opening a comment thread needs an actor. The worker cannot comment.')
  }
  return dbOf(scope).transaction(async (tx) => {
    const inserted = await tx
      .insert(commentThreads)
      .values({ ...tenant(scope), ...anchorColumns(anchor), state: 'open', createdBy: author })
      .returning()
    const row = inserted[0]
    if (row === undefined) {
      throw new Error('Folio: inserting a thread returned no row. This is a bug in the repository.')
    }
    await tx
      .insert(threadComments)
      .values({ ...tenant(scope), threadId: row.id, authorId: author, body })
    return toThread(row)
  })
}

/**
 * Every thread on one node.
 *
 * A thread whose anchor has been retired does not appear here, because the node
 * id no longer matches. Finding it takes the tombstone table and
 * `followMerge` - which is the shape a *detached* comment has, and detached is
 * a designed state rather than a loss.
 */
export const listThreadsForNode = async (
  scope: ProjectScope,
  nodeId: NodeId,
): Promise<readonly Thread[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(commentThreads)
    .where(scoped(scope, commentThreads, eq(commentThreads.anchorNodeId, nodeId)))
    .orderBy(asc(commentThreads.createdAt))
  return rows.map(toThread)
}

/** The Notes inbox: open threads across the project. */
export const listOpenThreads = async (scope: ProjectScope): Promise<readonly Thread[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(commentThreads)
    .where(scoped(scope, commentThreads, eq(commentThreads.state, 'open')))
    .orderBy(asc(commentThreads.createdAt))
  return rows.map(toThread)
}

/**
 * Threads whose anchor has gone.
 *
 * `anchor_node_id` is `ON DELETE SET NULL`, so deleting a node detaches its
 * threads rather than deleting them. This is the query that finds them, and it
 * is the reason the column is nullable at all.
 */
export const listDetachedThreads = async (scope: ProjectScope): Promise<readonly ThreadRow[]> => {
  return dbOf(scope)
    .select()
    .from(commentThreads)
    .where(
      scoped(
        scope,
        commentThreads,
        isNull(commentThreads.anchorNodeId),
        eq(commentThreads.anchorKind, 'script_node'),
      ),
    )
}

export const replyToThread = async (
  scope: ProjectScope,
  threadId: ThreadId,
  body: string,
): Promise<void> => {
  const author = scope.actor
  if (author === null) {
    throw new Error('Folio: replying to a thread needs an actor. The worker cannot comment.')
  }
  await dbOf(scope).transaction(async (tx) => {
    await tx.insert(threadComments).values({ ...tenant(scope), threadId, authorId: author, body })
    await tx
      .update(commentThreads)
      .set({ updatedAt: new Date() })
      .where(scoped(scope, commentThreads, eq(commentThreads.id, threadId)))
  })
}

export const listComments = async (
  scope: ProjectScope,
  threadId: ThreadId,
): Promise<readonly ThreadComment[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(threadComments)
    .where(scoped(scope, threadComments, eq(threadComments.threadId, threadId)))
    .orderBy(asc(threadComments.createdAt))
  return rows.map(toComment)
}

/**
 * Resolve or reopen.
 *
 * The three fields move together because `comment_threads_resolution_consistent`
 * requires it: a resolved thread carries when it was resolved, an open one
 * carries neither.
 */
export const setThreadState = async (
  scope: ProjectScope,
  threadId: ThreadId,
  state: Thread['state'],
): Promise<void> => {
  const now = new Date()
  await dbOf(scope)
    .update(commentThreads)
    .set(
      state === 'resolved'
        ? { state, resolvedAt: now, resolvedBy: scope.actor, updatedAt: now }
        : { state, resolvedAt: null, resolvedBy: null, updatedAt: now },
    )
    .where(scoped(scope, commentThreads, eq(commentThreads.id, threadId)))
}
