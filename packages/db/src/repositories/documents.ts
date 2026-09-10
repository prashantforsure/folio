import type { DocumentRecord, EpisodeId, NodeTombstone, OrderKey } from '@folio/contracts'
import { episodeId as brandEpisodeId, projectId as brandProjectId } from '@folio/contracts'
import { documentId as brandDocumentId, isErr, ok } from '@folio/script'
import type {
  DocumentId,
  DocumentKind,
  ModelDefect,
  NodeId,
  OutlineNode,
  Result,
  ScreenplayNode,
} from '@folio/script'
import { asc, eq, inArray } from 'drizzle-orm'

import { between, firstOrderKey, spread } from '../order'
import { documents, nodeTombstones, nodes } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import {
  nodeToWrite,
  outlineNodeFromRow,
  screenplayNodeFromRow,
  stamp,
} from './mapping'

/**
 * Documents, nodes and tombstones.
 *
 * The node list is the only hand-authored artefact in the product, so this is
 * the repository that matters most. Two things it deliberately does not do:
 *
 * **It does not mint node ids.** `@folio/script` cannot - it has no entropy, by
 * design, because determinism is what makes a speculative derive byte-identical
 * to the real one. So every operation there takes `freshIds` from its caller,
 * and the caller is ultimately here. `mintNodeIds` below is that supplier, and
 * it checks the tombstone table, because ADR 0001 says an id is never reused.
 *
 * **It does not decide what a valid node is.** Rows go through
 * `@folio/script`'s own reader on the way out. A malformed row is a `Result`
 * with a `ModelDefect` in it, not an exception and not a silently-dropped node -
 * a script that quietly loses a line is worse than one that refuses to load.
 */

type DocumentRow = typeof documents.$inferSelect

const toDocument = (row: DocumentRow): DocumentRecord => ({
  id: brandDocumentId(row.id),
  projectId: brandProjectId(row.projectId),
  episodeId: brandEpisodeId(row.episodeId),
  kind: row.kind,
  title: row.title,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const listDocuments = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
): Promise<readonly DocumentRecord[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(documents)
    .where(scoped(scope, documents, eq(documents.episodeId, episodeId)))
    .orderBy(asc(documents.kind))
  return rows.map(toDocument)
}

/**
 * The screenplay or the outline for an episode.
 *
 * One of each per episode, enforced by `documents_episode_kind_key`. Two
 * scripts for one episode is the state in which "the script is the single
 * source of truth" stops being a sentence anybody can act on.
 */
export const readDocumentByKind = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  kind: DocumentKind,
): Promise<DocumentRecord | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(documents)
    .where(
      scoped(scope, documents, eq(documents.episodeId, episodeId), eq(documents.kind, kind)),
    )
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toDocument(row)
}

export const createDocument = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  kind: DocumentKind,
  title: string,
): Promise<DocumentRecord> => {
  const inserted = await dbOf(scope)
    .insert(documents)
    .values({ ...tenant(scope), episodeId, kind, title })
    .returning()
  const row = inserted[0]
  if (row === undefined) {
    throw new Error('Folio: inserting a document returned no row. This is a bug in the repository.')
  }
  return toDocument(row)
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** A node row plus the ordering column the model does not carry. */
export type OrderedNode<T> = {
  readonly node: T
  readonly orderKey: OrderKey
}

const NODE_COLUMNS = {
  id: nodes.id,
  documentKind: nodes.documentKind,
  type: nodes.type,
  orderKey: nodes.orderKey,
  content: nodes.content,
  modifiers: nodes.modifiers,
  provenanceSource: nodes.provenanceSource,
  provenanceRunId: nodes.provenanceRunId,
}

/**
 * Every screenplay node in a document, in order.
 *
 * Ordered by `order_key`, which is a lexicographic fractional index - see
 * `../order.ts` for why it is text and not a float. A `Result`, because a row
 * that will not read is data about a broken document and the caller has to be
 * able to say so.
 */
export const readScreenplayNodes = async (
  scope: ProjectScope,
  documentId: DocumentId,
): Promise<Result<readonly OrderedNode<ScreenplayNode>[], ModelDefect>> => {
  const rows = await dbOf(scope)
    .select(NODE_COLUMNS)
    .from(nodes)
    .where(scoped(scope, nodes, eq(nodes.documentId, documentId)))
    .orderBy(asc(nodes.orderKey))
  const out: OrderedNode<ScreenplayNode>[] = []
  for (const row of rows) {
    const node = screenplayNodeFromRow(row)
    if (isErr(node)) return node
    out.push({ node: node.value, orderKey: row.orderKey as OrderKey })
  }
  return ok(out)
}

export const readOutlineNodes = async (
  scope: ProjectScope,
  documentId: DocumentId,
): Promise<Result<readonly OrderedNode<OutlineNode>[], ModelDefect>> => {
  const rows = await dbOf(scope)
    .select(NODE_COLUMNS)
    .from(nodes)
    .where(scoped(scope, nodes, eq(nodes.documentId, documentId)))
    .orderBy(asc(nodes.orderKey))
  const out: OrderedNode<OutlineNode>[] = []
  for (const row of rows) {
    const node = outlineNodeFromRow(row)
    if (isErr(node)) return node
    out.push({ node: node.value, orderKey: row.orderKey as OrderKey })
  }
  return ok(out)
}

/**
 * Replace a document's node list wholesale, in one transaction.
 *
 * This is what an operation from `@folio/script` commits through: those
 * functions return `{ nodes, identity, dropped }` over a whole list, so the
 * write is a whole list too. Order keys are regenerated by even spread rather
 * than preserved, which is correct for an import or a paste and wasteful for a
 * single keystroke - `moveNode` below is the cheap path for the latter.
 *
 * `identity` and `dropped` are **not** applied here. What happens to the
 * comments anchored to a retired id is a product decision (ADR 0001, Q4: the
 * analogous state for a comment is *detached*, not *deleted*), and this
 * repository will not make it in a commit. `retireNodes` is the explicit call.
 */
export const replaceNodes = async (
  scope: ProjectScope,
  documentId: DocumentId,
  kind: DocumentKind,
  list: readonly (ScreenplayNode | OutlineNode)[],
): Promise<void> => {
  const keys = spread(null, null, list.length)
  await dbOf(scope).transaction(async (tx) => {
    await tx.delete(nodes).where(scoped(scope, nodes, eq(nodes.documentId, documentId)))
    if (list.length === 0) return
    const values = list.map((node, index) => {
      const orderKey = keys[index] ?? firstOrderKey()
      const write = nodeToWrite(node, orderKey)
      return {
        ...tenant(scope),
        documentId,
        documentKind: kind,
        id: write.id,
        type: write.type,
        orderKey: write.orderKey,
        content: write.content,
        modifiers: [...write.modifiers],
        provenanceSource: write.provenanceSource,
        provenanceRunId: write.provenanceRunId,
      }
    })
    await tx.insert(nodes).values(values)
    await tx
      .update(documents)
      .set({ updatedAt: new Date() })
      .where(scoped(scope, documents, eq(documents.id, documentId)))
  })
}

/**
 * Move one node between two neighbours without touching anything else.
 *
 * This is the whole reason the order key is fractional: an insert or a move
 * writes exactly one row, so a paste in the middle of a feature does not
 * rewrite two hundred ordinals and does not race with anybody else's edit.
 */
export const moveNode = async (
  scope: ProjectScope,
  nodeId: NodeId,
  before: OrderKey | null,
  after: OrderKey | null,
): Promise<OrderKey> => {
  const orderKey = between(before, after)
  await dbOf(scope)
    .update(nodes)
    .set({ orderKey, updatedAt: new Date() })
    .where(scoped(scope, nodes, eq(nodes.id, nodeId)))
  return orderKey
}

// ---------------------------------------------------------------------------
// Tombstones
// ---------------------------------------------------------------------------

const toTombstone = (row: typeof nodeTombstones.$inferSelect): NodeTombstone => ({
  nodeId: row.nodeId as NodeId,
  projectId: brandProjectId(row.projectId),
  documentId: brandDocumentId(row.documentId),
  reason: row.reason,
  mergedInto: row.mergedInto === null ? null : (row.mergedInto as NodeId),
  retiredAt: stamp(row.retiredAt),
  retiredBy: row.retiredBy === null ? null : (row.retiredBy as NodeTombstone['retiredBy']),
})

/**
 * Retire node ids.
 *
 * ADR 0001, Consequences: "Delete tombstones and an id is never reused."
 * `merged` carries the survivor so an anchor on the loser can follow the text;
 * `deleted` has none, and pretending it did would re-point a comment at the
 * wrong line, which is the failure the whole ADR is written against.
 *
 * The node rows themselves are removed by `replaceNodes`. This is the record
 * that the ids existed, and it outlives them.
 */
export const retireNodes = async (
  scope: ProjectScope,
  documentId: DocumentId,
  retirements: readonly { readonly nodeId: NodeId; readonly mergedInto: NodeId | null }[],
): Promise<void> => {
  if (retirements.length === 0) return
  await dbOf(scope)
    .insert(nodeTombstones)
    .values(
      retirements.map((retirement) => ({
        ...tenant(scope),
        documentId,
        nodeId: retirement.nodeId,
        reason: retirement.mergedInto === null ? ('deleted' as const) : ('merged' as const),
        mergedInto: retirement.mergedInto,
        retiredBy: scope.actor,
      })),
    )
    .onConflictDoNothing({ target: nodeTombstones.nodeId })
}

export const readTombstones = async (
  scope: ProjectScope,
  ids: readonly NodeId[],
): Promise<readonly NodeTombstone[]> => {
  if (ids.length === 0) return []
  const rows = await dbOf(scope)
    .select()
    .from(nodeTombstones)
    .where(scoped(scope, nodeTombstones, inArray(nodeTombstones.nodeId, [...ids])))
  return rows.map(toTombstone)
}

/**
 * Follow a retired id to whatever survived.
 *
 * Walks the merge chain, because a node merged twice has two tombstones and an
 * anchor on the first has to reach the last. Returns `null` for an id that was
 * deleted rather than merged - a detached anchor, which is a designed state.
 *
 * The `seen` set is not paranoia: a merge chain is written by application code
 * and a cycle would otherwise hang a page render rather than fail.
 */
export const followMerge = async (
  scope: ProjectScope,
  id: NodeId,
): Promise<NodeId | null> => {
  const seen = new Set<string>([id])
  let current = id
  for (;;) {
    const rows = await dbOf(scope)
      .select({ mergedInto: nodeTombstones.mergedInto })
      .from(nodeTombstones)
      .where(scoped(scope, nodeTombstones, eq(nodeTombstones.nodeId, current)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return current
    if (row.mergedInto === null) return null
    const next = row.mergedInto as NodeId
    if (seen.has(next)) return null
    seen.add(next)
    current = next
  }
}

/**
 * Ids for nodes about to be created, none of which has ever been used.
 *
 * `@folio/script` cannot mint one - no `Math.random`, no `crypto`, no
 * `Date.now()` - so `parseFountain`, `importFinalDraft`, `derive` and every
 * operation take `freshIds` from their caller. This is the supplier.
 *
 * Candidates come from the platform's `crypto.randomUUID`, which is the same
 * v4 shape as the `gen_random_uuid()` default on the columns. Minting in
 * process rather than asking Postgres is what lets the editor create a node
 * optimistically, before any round trip.
 *
 * The tombstone check is what makes "never reused" true rather than merely
 * overwhelmingly likely. A v4 collision is not going to happen; the check costs
 * one indexed lookup on a path that is about to write rows anyway, and the
 * guarantee is one the rest of the system leans on.
 */
export const mintNodeIds = async (
  scope: ProjectScope,
  count: number,
): Promise<readonly NodeId[]> => {
  if (count <= 0) return []
  const db = dbOf(scope)
  const minted: NodeId[] = []
  while (minted.length < count) {
    const candidates = Array.from(
      { length: count - minted.length },
      () => crypto.randomUUID() as NodeId,
    )
    const taken = await db
      .select({ nodeId: nodeTombstones.nodeId })
      .from(nodeTombstones)
      .where(scoped(scope, nodeTombstones, inArray(nodeTombstones.nodeId, candidates)))
    const used = new Set(taken.map((row) => row.nodeId))
    for (const candidate of candidates) {
      if (!used.has(candidate)) minted.push(candidate)
    }
  }
  return minted
}
