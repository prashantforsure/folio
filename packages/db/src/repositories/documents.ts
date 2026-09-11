import type { DocumentRecord, EpisodeId, NodeTombstone, OrderKey, Timestamp } from '@folio/contracts'
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
import { asc, eq, inArray, sql } from 'drizzle-orm'

import type { NodeWritePlan, StoredNodeRow } from '../node-plan'
import { planNodeWrite } from '../node-plan'
import { between, byOrderKey, firstOrderKey, spread } from '../order'
import { documents, episodes, nodeTombstones, nodes } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'
import type { NodeWrite } from './mapping'
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

/**
 * One document by id, or null. The Script route's save names the document
 * it is writing, so the row is read by that id - in parallel with the gate -
 * and checked against the episode afterwards, rather than found through it.
 */
export const readDocumentById = async (
  scope: ProjectScope,
  documentId: DocumentId,
): Promise<DocumentRecord | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(documents)
    .where(scoped(scope, documents, eq(documents.id, documentId)))
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
 * `../order.ts` for why it is text and not a float, and `byOrderKey` there
 * for why the sort names its collation. A `Result`, because a row
 * that will not read is data about a broken document and the caller has to be
 * able to say so.
 */
export const readScreenplayNodes = async (
  scope: ProjectScope,
  documentId: DocumentId,
): Promise<Result<readonly OrderedNode<ScreenplayNode>[], ModelDefect>> =>
  parseScreenplayRows(await readNodeRows(scope, documentId))

/** A stored node row, exactly as the save path compares and rewrites it. */
export type NodeRow = StoredNodeRow & { readonly documentKind: DocumentKind }

/**
 * The rows of one document, in order, unparsed.
 *
 * The save path needs both the parsed list (to paginate) and the raw rows
 * (to plan the write against), and a round trip is the unit of cost on the
 * request path - so the rows are read once and parsed in memory.
 */
export const readNodeRows = async (
  scope: ProjectScope,
  documentId: DocumentId,
): Promise<readonly NodeRow[]> =>
  dbOf(scope)
    .select(NODE_COLUMNS)
    .from(nodes)
    .where(scoped(scope, nodes, eq(nodes.documentId, documentId)))
    .orderBy(byOrderKey(nodes.orderKey))

export const parseScreenplayRows = (
  rows: readonly NodeRow[],
): Result<readonly OrderedNode<ScreenplayNode>[], ModelDefect> => {
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
): Promise<Result<readonly OrderedNode<OutlineNode>[], ModelDefect>> =>
  parseOutlineRows(await readNodeRows(scope, documentId))

/** The outline's rows, read strictly - `parseScreenplayRows` for the other kind. */
export const parseOutlineRows = (
  rows: readonly NodeRow[],
): Result<readonly OrderedNode<OutlineNode>[], ModelDefect> => {
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
  const writes = list.map((node, index) => nodeToWrite(node, keys[index] ?? firstOrderKey()))
  await dbOf(scope).transaction(async (tx) => {
    // Two statements, not one: the fresh keys are the same deterministic
    // spread the old rows got, and a delete and an insert in one statement
    // share a snapshot - see `node-plan.ts` - so the old rows would still
    // be in the unique index when the new ones landed.
    await tx.delete(nodes).where(scoped(scope, nodes, eq(nodes.documentId, documentId)))
    await tx.execute(sql`
      with ins as (
        insert into ${nodes} (id, project_id, document_id, document_kind, type, order_key, content, modifiers, provenance_source, provenance_run_id)
        select r.id, ${scope.projectId}, ${documentId}, ${kind}::document_kind, r.type, r.order_key, r.content, r.modifiers, r.provenance_source, r.provenance_run_id
        from jsonb_to_recordset(${jsonb(writes.map(nodeWriteRecord))}) as ${NODE_RECORD}
        returning id
      )
      update ${documents} set updated_at = now()
      where ${scoped(scope, documents, eq(documents.id, documentId))}
        and (select count(*) from ins) = ${writes.length}
    `)
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

// ---------------------------------------------------------------------------
// Writing a node list back - the Script route's save path
// ---------------------------------------------------------------------------

/**
 * The record shape `jsonb_to_recordset` reads a node write as. The enum
 * names are the Postgres types `schema/documents.ts` declares; a wrong one
 * fails the statement, never a row.
 */
const NODE_RECORD = sql.raw(
  'r(id uuid, type node_type, order_key text, content jsonb, modifiers delivery_modifier[], provenance_source provenance_source, provenance_run_id uuid)',
)

/** A `NodeWrite` in the column names the record above declares. */
const nodeWriteRecord = (write: NodeWrite) => ({
  id: write.id,
  type: write.type,
  order_key: write.orderKey,
  content: write.content,
  modifiers: write.modifiers,
  provenance_source: write.provenanceSource,
  provenance_run_id: write.provenanceRunId,
})

export type ReconcileSummary = {
  readonly inserted: number
  readonly updated: number
  readonly deleted: number
  readonly rekeyed: number
  /** `documents.updated_at` after the write. The save's new base version. */
  readonly updatedAt: Timestamp
}

export type NodeRetirement = {
  readonly nodeId: NodeId
  readonly mergedInto: NodeId | null
}

/**
 * Apply a plan from `planNodeWrite` - in **one statement**.
 *
 * The request path pays two round trips per parameterised statement and
 * cannot pipeline them (`client.ts`), so the shape of this write is the
 * cost of a keystroke. Everything a save does to the authored tables is one
 * `WITH`: the id check, the deletes, the tombstones, the inserts, the
 * updates and the document stamp. One statement is also one snapshot and
 * one atomic commit, which is why the plan's keys are chosen never to
 * collide with a stored one (`node-plan.ts`).
 *
 * Ids new to the document are checked against the tombstones and against
 * every node in the project (ADR 0001: never reused, globally unique) in the
 * same statement, and every writing clause is gated on that check passing:
 * a reused id refuses the whole write and names the ids, the caller
 * re-mints, and nothing was touched.
 *
 * `retirements` are the tombstones for ids that left the list - what
 * `retireNodes` writes, landed in the same statement as the delete so an
 * id can never be gone without its tombstone. The *decision* to retire, and
 * what an id was merged into, is still the caller's (the header of
 * `replaceNodes` says why); this only refuses to let the two halves of it
 * commit separately.
 */
export const commitNodePlan = async (
  scope: ProjectScope,
  documentId: DocumentId,
  kind: DocumentKind,
  plan: NodeWritePlan,
  retirements: readonly NodeRetirement[] = [],
): Promise<ReconcileSummary | { readonly unusable: readonly NodeId[] }> => {
  const introduced = sql.param([...plan.introduced])
  const tombstones = retirements.map((retirement) => ({
    node_id: retirement.nodeId,
    reason: retirement.mergedInto === null ? 'deleted' : 'merged',
    merged_into: retirement.mergedInto,
  }))
  const rows = await dbOf(scope).execute(sql`
    with bad as (
      select ${nodeTombstones.nodeId} as id from ${nodeTombstones}
        where ${scoped(scope, nodeTombstones, sql`${nodeTombstones.nodeId} = any(${introduced}::uuid[])`)}
      union
      select ${nodes.id} as id from ${nodes}
        where ${scoped(scope, nodes, sql`${nodes.id} = any(${introduced}::uuid[])`)}
    ),
    ok as (select not exists (select 1 from bad) as ok),
    del as (
      delete from ${nodes}
      where ${scoped(scope, nodes, eq(nodes.documentId, documentId), sql`${nodes.id} = any(${sql.param([...plan.deletes])}::uuid[])`)}
        and (select ok from ok)
      returning id
    ),
    tomb as (
      insert into ${nodeTombstones} (project_id, document_id, node_id, reason, merged_into, retired_by)
      select ${scope.projectId}, ${documentId}, r.node_id, r.reason, r.merged_into, ${scope.actor}::uuid
      from jsonb_to_recordset(${jsonb(tombstones)}) as r(node_id uuid, reason tombstone_reason, merged_into uuid)
      where (select ok from ok)
      on conflict (node_id) do nothing
      returning node_id
    ),
    ins as (
      insert into ${nodes} (id, project_id, document_id, document_kind, type, order_key, content, modifiers, provenance_source, provenance_run_id)
      select r.id, ${scope.projectId}, ${documentId}, ${kind}::document_kind, r.type, r.order_key, r.content, r.modifiers, r.provenance_source, r.provenance_run_id
      from jsonb_to_recordset(${jsonb(plan.inserts.map(nodeWriteRecord))}) as ${NODE_RECORD}
      where (select ok from ok)
      returning id
    ),
    upd as (
      update ${nodes} set
        type = r.type, order_key = r.order_key, content = r.content, modifiers = r.modifiers,
        provenance_source = r.provenance_source, provenance_run_id = r.provenance_run_id, updated_at = now()
      from jsonb_to_recordset(${jsonb(plan.updates.map(nodeWriteRecord))}) as ${NODE_RECORD}
      where ${scoped(scope, nodes, eq(nodes.documentId, documentId))}
        and ${nodes.id} = r.id
        and (select ok from ok)
      returning ${nodes.id}
    ),
    stamp as (
      update ${documents} set updated_at = now()
      where ${scoped(scope, documents, eq(documents.id, documentId))}
        and (select ok from ok)
      returning updated_at
    )
    select
      (select array_agg(id) from bad) as unusable,
      (select updated_at from stamp) as updated_at,
      (select count(*)::int from ins) as inserted,
      (select count(*)::int from upd) as updated,
      (select count(*)::int from del) as deleted
  `)
  const row = rows[0] as
    | {
        readonly unusable: readonly string[] | null
        readonly updated_at: Date | string | null
        readonly inserted: number
        readonly updated: number
        readonly deleted: number
      }
    | undefined
  if (row === undefined) {
    throw new Error('Folio: the node write returned no row. This is a bug in the repository.')
  }
  if (row.unusable !== null && row.unusable.length > 0) {
    return { unusable: row.unusable.map((id) => id as NodeId) }
  }
  if (row.updated_at === null) {
    throw new Error(
      'Folio: the node write touched no document row. This is a bug in the repository.',
    )
  }
  return {
    inserted: row.inserted,
    updated: row.updated,
    deleted: row.deleted,
    rekeyed: plan.rekeyed,
    // Raw `execute` bypasses the column parsers: a timestamp arrives as text.
    updatedAt: stamp(row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)),
  }
}

/**
 * Write a node list back with the fewest rows touched.
 *
 * Read the stored rows, plan against them (`planNodeWrite`), commit the
 * plan. Two round trips. The read is not inside the write's transaction: a
 * concurrent save between the two is caught by the unique index on
 * `(document_id, order_key)` - a fresh key cannot collide with anything the
 * plan saw, so if it collides the statement fails whole and the caller
 * retries against the new rows - and by `documents.updated_at`, which the
 * Script route compares to report the conflict.
 */
export const reconcileNodes = async (
  scope: ProjectScope,
  documentId: DocumentId,
  kind: DocumentKind,
  list: readonly ScreenplayNode[],
): Promise<ReconcileSummary | { readonly unusable: readonly NodeId[] }> => {
  const existing = await readNodeRows(scope, documentId)
  return commitNodePlan(scope, documentId, kind, planNodeWrite(existing, list))
}

/**
 * Which of these ids may not be introduced as new nodes.
 *
 * ADR 0001: an id is never reused. A client mints ids optimistically (the
 * editor cannot wait for a round trip on every Enter), so the server checks
 * them on the way in: an id that is tombstoned, or that already exists on any
 * node in the project, is refused. Global uniqueness is what keeps the comment
 * join a single column, so the second check is across every document.
 */
export const findUnusableIds = async (
  scope: ProjectScope,
  ids: readonly NodeId[],
): Promise<readonly NodeId[]> => {
  if (ids.length === 0) return []
  const db = dbOf(scope)
  const [tombstoned, present] = await Promise.all([
    db
      .select({ id: nodeTombstones.nodeId })
      .from(nodeTombstones)
      .where(scoped(scope, nodeTombstones, inArray(nodeTombstones.nodeId, [...ids]))),
    db
      .select({ id: nodes.id })
      .from(nodes)
      .where(scoped(scope, nodes, inArray(nodes.id, [...ids]))),
  ])
  const unusable = new Set<string>([...tombstoned, ...present].map((row) => row.id))
  return ids.filter((id) => unusable.has(id))
}

/**
 * Every screenplay node in the project, in episode order then document order.
 *
 * Derivation is project-wide - "Entities stay project-wide" (the Script
 * bundle's own copy) - so it reads one list across every episode's script.
 * A row that will not read is a `ModelDefect`, as with the per-document read.
 */
export const readProjectScreenplayNodes = async (
  scope: ProjectScope,
): Promise<Result<readonly ScreenplayNode[], ModelDefect>> => {
  const rows = await dbOf(scope)
    .select({ ...NODE_COLUMNS, ordinal: episodes.ordinal })
    .from(nodes)
    .innerJoin(documents, eq(documents.id, nodes.documentId))
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(scoped(scope, nodes, eq(nodes.documentKind, 'screenplay')))
    .orderBy(asc(episodes.ordinal), byOrderKey(nodes.orderKey))
  const out: ScreenplayNode[] = []
  for (const row of rows) {
    const node = screenplayNodeFromRow(row)
    if (isErr(node)) return node
    out.push(node.value)
  }
  return ok(out)
}
