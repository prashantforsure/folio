import { TOMBSTONE_REASONS } from '@folio/contracts'
import {
  DELIVERY_MODIFIERS,
  DOCUMENT_KINDS,
  OUTLINE_NODE_TYPES,
  PROVENANCE_SOURCES,
  SCREENPLAY_NODE_TYPES,
} from '@folio/script'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  createdAtColumn,
  idColumn,
  orderKeyColumn,
  projectIdColumn,
  timestampColumn,
  updatedAtColumn,
} from './columns'
import { episodes, projects, users } from './tenancy'

/**
 * Documents and nodes.
 *
 * AGENTS.md, The node model: "A script is an **ordered list of typed nodes**,
 * not a text blob", and the Outline is "a **different document kind in the same
 * table** with a different, tiny, closed block set (Body, H1, H2, H3, Quote,
 * Rule, numbered beats). Do not widen the screenplay schema to hold an `H2`."
 *
 * Both halves of that sentence are load-bearing and they pull in opposite
 * directions: one table, two block sets that must not mix. How that is enforced
 * is the most interesting thing in this file - see `nodes` below.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const documentKindEnum = pgEnum('document_kind', DOCUMENT_KINDS)
export const provenanceSourceEnum = pgEnum('provenance_source', PROVENANCE_SOURCES)
export const deliveryModifierEnum = pgEnum('delivery_modifier', DELIVERY_MODIFIERS)
export const tombstoneReasonEnum = pgEnum('tombstone_reason', TOMBSTONE_REASONS)

/**
 * Every tag either block set uses, in one Postgres type.
 *
 * The two sets share no member - `@folio/script`'s `outline.ts` says so
 * explicitly: "`ScreenplayNode` and `OutlineNode` have no member in common -
 * not even `body`/`action`, which are superficially the same shape." That is
 * what makes one enum safe: there is no tag for which the owning document kind
 * is ambiguous, so the check constraint below can decide from the tag alone.
 */
export const nodeTypeEnum = pgEnum('node_type', [
  ...SCREENPLAY_NODE_TYPES,
  ...OUTLINE_NODE_TYPES,
] as [string, ...string[]])

/**
 * A tuple of tags as a SQL literal list: `'scene', 'action', ...`.
 *
 * Needed because a check constraint has to be **literal** SQL. Interpolating a
 * value into a Drizzle `sql` template makes it a bound parameter, and
 * drizzle-kit dumps a bound parameter into the migration as `$1` - which is not
 * valid in a `CHECK`, and which the first `drizzle-kit migrate` would reject.
 * That is exactly what the first generated migration did, before this function
 * existed.
 *
 * `sql.raw` is normally the wrong tool and is worth justifying: the only inputs
 * are the two `as const` tuples in `@folio/script`, which are compile-time
 * constants with no user data anywhere near them. The quote-doubling is belt
 * and braces in case a future element type ever contains an apostrophe.
 */
const quotedList = (values: readonly string[]): string =>
  values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

/**
 * A document header. AUTHORED.
 *
 * One table, two kinds, discriminated by `kind`. The nodes are their own table
 * so a document can be listed without dragging a feature-length node list
 * along.
 *
 * The unique index on `(id, kind)` looks redundant - `id` is already the
 * primary key. It is not decoration: it is the target of the composite foreign
 * key on `nodes`, which is what makes a node's copy of the document kind
 * impossible to falsify. Postgres requires a unique constraint on the
 * referenced columns, so this index is the thing that lets that mechanism
 * exist.
 */
export const documents = pgTable(
  'documents',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    kind: documentKindEnum('kind').notNull(),
    title: text('title').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    // The target of nodes' composite FK. See the note above.
    uniqueIndex('documents_id_kind_key').on(table.id, table.kind),
    index('documents_project_idx').on(table.projectId),
    index('documents_episode_idx').on(table.episodeId),
    // One screenplay and one outline per episode. Two scripts for one episode
    // is the state where "the script is the single source of truth" stops
    // being a sentence anyone can act on.
    uniqueIndex('documents_episode_kind_key').on(table.episodeId, table.kind),
  ],
)

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

/**
 * One node. AUTHORED.
 *
 * ## How the two block sets are kept apart
 *
 * A check constraint cannot read another table, so `nodes` cannot ask
 * `documents` what kind it is at write time. The usual workaround is to
 * denormalise the kind onto the node - which would be storing something
 * computable, and AGENTS.md's exception table is explicit that its list is
 * complete and there is no third case.
 *
 * The resolution is that `document_kind` here is **not a copy**. It is half of
 * a composite foreign key: `(document_id, document_kind)` references
 * `documents (id, kind)`. Postgres will not let the pair exist unless that
 * exact pair exists in `documents`, so the column cannot drift from its source
 * even for the duration of a transaction. It is a foreign key column that
 * happens to be readable, not a cached value.
 *
 * With that in place the check constraint is local and total:
 *
 *   screenplay documents admit the eight screenplay tags, and nothing else
 *   outline documents admit the seven outline tags, and nothing else
 *
 * "Rejecting anything outside the eight types is that schema's entire job"
 * (AGENTS.md), and this is that job done in the place where a migration, a
 * `psql` session and an application bug all pass through.
 *
 * ## What is not here
 *
 * No `page`. No `page_number`, `pages`, `eighths` or `measurement` either -
 * `PAGINATION_FIELDS` in `@folio/script` names all five and `read.ts` rejects
 * them at the wire. There is no column for any of them and there never will be.
 * A node's position on a sheet lives on a measurement record, which points at
 * the node; the node does not point back.
 *
 * No `character_id` on a cue, either. Resolving a cue to a person goes through
 * the alias table, and a resolved id cached here would be a second authority on
 * who is speaking.
 */
export const nodes = pgTable(
  'nodes',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    /** Not a copy of `documents.kind` - half of the composite FK. See above. */
    documentKind: documentKindEnum('document_kind').notNull(),
    type: nodeTypeEnum('type').notNull(),
    /** Fractional index, compared as text. Storage's ordering, not the model's. */
    orderKey: orderKeyColumn(),
    /** `InlineContent`: a list of runs, because a mention is a reference, not text. */
    content: jsonb('content').notNull(),
    /** Authored only. Never `(CONT'D)`. Empty for every type but a cue. */
    modifiers: deliveryModifierEnum('modifiers')
      .array()
      .notNull()
      .default(sql`ARRAY[]::delivery_modifier[]`),
    provenanceSource: provenanceSourceEnum('provenance_source').notNull(),
    provenanceRunId: uuid('provenance_run_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({
      columns: [table.documentId, table.documentKind],
      foreignColumns: [documents.id, documents.kind],
      name: 'nodes_document_kind_fk',
    }).onDelete('cascade'),
    uniqueIndex('nodes_document_order_key').on(table.documentId, table.orderKey),
    index('nodes_document_idx').on(table.documentId),
    index('nodes_project_idx').on(table.projectId),
    /**
     * The closed sets, enforced per document kind.
     *
     * Written from the imported tuples rather than typed out, so adding a ninth
     * element type to `@folio/script` changes this constraint in the next
     * generated migration instead of silently leaving it behind.
     */
    check(
      'nodes_type_matches_document_kind',
      sql`(
        (${table.documentKind} = 'screenplay' AND ${table.type} IN (${sql.raw(quotedList(SCREENPLAY_NODE_TYPES))}))
        OR
        (${table.documentKind} = 'outline' AND ${table.type} IN (${sql.raw(quotedList(OUTLINE_NODE_TYPES))}))
      )`,
    ),
    /**
     * Provenance is a discriminated union in the model - `typed`, or `agent`
     * with a run. A row cannot hold a union, so this constraint stands in for
     * it: "agent-authored with no run" is unrepresentable here too, not merely
     * discouraged.
     */
    check(
      'nodes_provenance_run_matches_source',
      sql`(${table.provenanceSource} = 'agent') = (${table.provenanceRunId} IS NOT NULL)`,
    ),
    /** Only a cue carries delivery modifiers. Nothing else can. */
    check(
      'nodes_modifiers_only_on_cues',
      sql`${table.type} = 'character' OR cardinality(${table.modifiers}) = 0`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// node_tombstones
// ---------------------------------------------------------------------------

/**
 * A retired node id. AUTHORED.
 *
 * `docs/adr/0001-node-identity.md`, Q4 and Consequences: delete tombstones, "an
 * id is never reused", and `packages/db` "needs somewhere to record a retired
 * id and the detached anchors that used to point at it."
 *
 * The primary key is the node id itself, which is what makes "never reused"
 * checkable rather than aspirational: a tombstoned id cannot be inserted here
 * twice, and a repository that mints ids checks this table.
 *
 * `merged_into` is set only when the id lost a merge. A delete has no successor
 * and pretending it did would re-point a comment at the wrong line - the exact
 * failure the ADR is written against - so the check constraint ties the two
 * fields together rather than leaving it to the caller.
 *
 * There is no list of detached anchors here. A thread carries its own
 * `anchor_node_id`; a repository resolves it through this table. A second list
 * would be a second authority on which comments are detached.
 */
export const nodeTombstones = pgTable(
  'node_tombstones',
  {
    nodeId: uuid('node_id').primaryKey(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    reason: tombstoneReasonEnum('reason').notNull(),
    /** The surviving id, when this one lost a merge. Null for a delete. */
    mergedInto: uuid('merged_into'),
    retiredAt: timestampColumn('retired_at').notNull().defaultNow(),
    retiredBy: uuid('retired_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('node_tombstones_project_idx').on(table.projectId),
    index('node_tombstones_merged_into_idx').on(table.mergedInto),
    check(
      'node_tombstones_merge_names_survivor',
      sql`(${table.reason} = 'merged') = (${table.mergedInto} IS NOT NULL)`,
    ),
  ],
)
