import { z } from 'zod'

import {
  DeliveryModifierSchema,
  DocumentKindSchema,
  OutlineNodeTypeSchema,
  ProvenanceSourceSchema,
  ScreenplayNodeTypeSchema,
  TombstoneReasonSchema,
} from './enums'
import {
  DocumentIdSchema,
  EpisodeIdSchema,
  NodeIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  UserIdSchema,
} from './ids'
import { OrderKeySchema, TimestampSchema, TitleSchema } from './primitives'

/**
 * Documents and nodes at the boundary.
 *
 * AGENTS.md, The node model: "A script is an **ordered list of typed nodes**,
 * not a text blob", and the Outline is "a **different document kind in the same
 * table** with a different, tiny, closed block set".
 *
 * ## Why a node row is not a `ScreenplayNode`
 *
 * `@folio/script` declares `ScreenplayNode` and `OutlineNode`, and `model.ts`
 * in this package carries them across the wire unchanged. A **node row** is a
 * different thing: it is one of those nodes plus the three facts storage adds -
 * which document it belongs to, where it sits in the order, and when it was
 * touched. Those three are not part of the model and must never become part of
 * it. `ScreenplayNode` deliberately carries no `documentId` and no `order`,
 * because a node list is *ordered by being a list*, and giving each node an
 * ordinal would create a second authority on document order.
 *
 * So the row schema composes rather than redeclares: `node` is the model value,
 * read by the pure core's own reader, and the storage fields sit beside it.
 * There is no flattened `{ id, type, content, documentId, order }` anywhere -
 * that shape is exactly how a `page` column eventually gets added to a node.
 */

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * A document row: the header, without its nodes.
 *
 * One table for both kinds, discriminated by `kind`. The nodes live in their
 * own table and a document is read with them by a repository, so the header can
 * be listed without dragging a feature-length node list along.
 *
 * `episodeId` is not nullable. Every document belongs to an episode, and a film
 * has one episode, per AGENTS.md, Routing - "the router special-cases the
 * shape; the schema never does".
 */
export const DocumentRecordSchema = z.object({
  id: DocumentIdSchema,
  projectId: ProjectIdSchema,
  episodeId: EpisodeIdSchema,
  kind: DocumentKindSchema,
  title: TitleSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type DocumentRecord = z.infer<typeof DocumentRecordSchema>

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where a node came from, as a row reads it.
 *
 * `@folio/script` models this as a discriminated union so that "agent-authored
 * with no run" is unrepresentable. A row cannot hold a union, so storage holds
 * `source` plus a nullable `run_id` and the repository reassembles the union on
 * the way out - which is why this schema exists and why it refines: it is the
 * one place the two representations meet, and the refinement is what stops the
 * lossy pair leaking past it.
 */
export const NodeProvenanceRowSchema = z
  .object({
    source: ProvenanceSourceSchema,
    runId: RunIdSchema.nullable(),
  })
  .refine(
    (value) => (value.source === 'agent') === (value.runId !== null),
    'Provenance is typed with no run, or agent with a run. Never either mixed.',
  )

export type NodeProvenanceRow = z.infer<typeof NodeProvenanceRowSchema>

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * The type tag on a node row.
 *
 * The union of the two closed sets, and it is a union of *tags*, not of block
 * shapes. Which half is legal is decided by the owning document's `kind`, and
 * `packages/db` enforces that pairing with a check constraint rather than
 * trusting this schema - because a row can be written by a migration or by
 * `psql`, and neither passes through Zod.
 *
 * The two sets share no member, which is what makes the union safe to write
 * down: there is no tag for which the document kind is ambiguous.
 */
export const NodeTypeSchema = z.union([ScreenplayNodeTypeSchema, OutlineNodeTypeSchema])

export type NodeType = z.infer<typeof NodeTypeSchema>

/**
 * One row of the nodes table.
 *
 * `content` is the model's `InlineContent` - a list of runs, because an
 * `@mention` is a structural reference to a record id and not text. It is
 * carried as JSON and read back through the pure core's reader; see
 * `nodeRowToScreenplayNode` in `packages/db`, which is the only place a row
 * becomes a node.
 *
 * There is no `page`, `pageNumber`, `pages`, `eighths` or `measurement` field,
 * and there never will be. `read.ts` in `@folio/script` rejects all five by
 * name and `packages/db` does not define a column for any of them.
 */
export const NodeRowSchema = z.object({
  id: NodeIdSchema,
  projectId: ProjectIdSchema,
  documentId: DocumentIdSchema,
  type: NodeTypeSchema,
  /** Storage's ordering, not the model's. See the file header. */
  order: OrderKeySchema,
  /** `InlineContent`, as JSON. Validated by the pure core, not here. */
  content: z.unknown(),
  /** Authored only. Never `(CONT'D)`. Empty for every type but a cue. */
  modifiers: z.array(DeliveryModifierSchema),
  provenance: NodeProvenanceRowSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type NodeRow = z.infer<typeof NodeRowSchema>

// ---------------------------------------------------------------------------
// Tombstones
// ---------------------------------------------------------------------------

/**
 * A retired node id.
 *
 * `docs/adr/0001-node-identity.md`, Q4 and Consequences: delete is a tombstone,
 * "an id is never reused", and `packages/db` "needs somewhere to record a
 * retired id and the detached anchors that used to point at it". This is that
 * somewhere.
 *
 * `mergedInto` is set when the id lost a merge rather than being deleted. It is
 * what lets an anchor on the loser follow the text instead of being orphaned,
 * and it is why the reason and the pointer are two fields: a delete has no
 * successor, and pretending it does would silently re-point a comment at the
 * wrong line - the exact failure the ADR is written against.
 *
 * The anchors themselves are not listed here. A thread carries its own
 * `anchorNodeId` and a repository resolves it through this table; duplicating
 * the list would be a second authority on which comments are detached.
 */
export const NodeTombstoneSchema = z
  .object({
    nodeId: NodeIdSchema,
    projectId: ProjectIdSchema,
    documentId: DocumentIdSchema,
    reason: TombstoneReasonSchema,
    /** The surviving id, when this one lost a merge. Null for a delete. */
    mergedInto: NodeIdSchema.nullable(),
    retiredAt: TimestampSchema,
    retiredBy: UserIdSchema.nullable(),
  })
  .refine(
    (value) => (value.reason === 'merged') === (value.mergedInto !== null),
    'A merged tombstone names its survivor; a deleted one has none.',
  )

export type NodeTombstone = z.infer<typeof NodeTombstoneSchema>
