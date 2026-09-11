import { VERSION_REASONS } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAtColumn, idColumn, projectIdColumn } from './columns'
import { documents, nodes } from './documents'
import { episodes, projects, revisionColourEnum, users } from './tenancy'

/**
 * Versions and revisions. Two tables, on purpose.
 *
 * This is the distinction the brief for this phase names, and it is worth
 * stating in the schema because the two look alike and conflating them is
 * invisible until a production office is holding paper.
 *
 * **A version is the editor's undo-history backstop.** A snapshot of a
 * document, taken often, so a bad paste or a bad agent run can be walked back.
 * AGENTS.md, Constraints: there is no realtime collaboration, so writes are
 * "last-write-wins with a conflict banner" - a version is what makes losing
 * that race survivable. It is cheap, it is frequent, and it can be pruned.
 *
 * **A revision is a production artefact.** A coloured draft that goes to a crew:
 * White, Blue, Pink, Yellow, Green. It carries an author, a note, tags,
 * added/deleted line counts and a locked flag, and its pages must not renumber -
 * AGENTS.md: "**Locked pages must not renumber.** That is the entire point of
 * the colour system." It is never pruned, because it records what specific
 * people were handed on a specific day.
 *
 * One table would force a choice between the two: either versions become too
 * expensive to take often enough to be an undo backstop, or revisions get
 * pruned and the production record grows holes.
 */

/**
 * `before_restore` and `restore` are the pair a restore writes (migration
 * `0004`). The Revisions route's rule is "Restore creates a new version. It
 * never destroys history": the first row is the document as it stood before
 * the restore, so nothing the writer had is lost; the second is the restored
 * document itself, so the restore is a version in the chain and not a rewind
 * of it. Two rows rather than one, because the first is what makes the
 * second reversible.
 */
export const versionReasonEnum = pgEnum('version_reason', VERSION_REASONS)

// ---------------------------------------------------------------------------
// versions
// ---------------------------------------------------------------------------

/**
 * A snapshot of one document. AUTHORED.
 *
 * `snapshot` is the whole node list as JSON, read back through
 * `@folio/script`'s own reader. Storing the list rather than a diff is the
 * choice that makes a restore a single write and makes it impossible for a
 * chain of diffs to be individually valid and collectively wrong.
 *
 * `node_count` is stored, and it is the one count in this schema that is not a
 * derived cache. A snapshot is immutable, so the count is a property of a
 * frozen artefact and cannot drift from it. It exists so the version list
 * renders without deserialising a feature-length node list per row.
 *
 * `reason` says what took the snapshot. `before_agent_run` is what makes
 * "revert this run" one operation rather than a reverse-diff, which matters
 * because AGENTS.md says one run produces one revision entry and a writer will
 * want to undo exactly that.
 */
export const versions = pgTable(
  'versions',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Monotonic within a document, not a global sequence. */
    ordinal: integer('ordinal').notNull(),
    reason: versionReasonEnum('reason').notNull(),
    /** The document at that moment. Validated by `@folio/script`, never by SQL. */
    snapshot: jsonb('snapshot').notNull(),
    nodeCount: integer('node_count').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('versions_document_ordinal_key').on(table.documentId, table.ordinal),
    index('versions_project_idx').on(table.projectId),
    index('versions_document_created_idx').on(table.documentId, table.createdAt),
    check('versions_ordinal_positive', sql`${table.ordinal} >= 1`),
    check('versions_node_count_not_negative', sql`${table.nodeCount} >= 0`),
  ],
)

// ---------------------------------------------------------------------------
// revisions
// ---------------------------------------------------------------------------

/**
 * A coloured production draft. AUTHORED.
 *
 * `colour` is the value `@folio/script` defines. That package keeps the
 * sequence rather than `packages/ui` for a reason worth repeating here: "a
 * production office reads a colour off a physical page; it is a property of the
 * revision, the same way a page number is a property of the measurement." The
 * moment it becomes a `--revision-blue` token it can be themed, and a themed
 * salmon page is a wrong page.
 *
 * `lines_added` and `lines_deleted` are stored, and this is the second place in
 * this schema where "nothing is stored that can be computed" needs an argument
 * rather than an exemption. They describe the diff between two **frozen**
 * snapshots, so recomputing them can only ever return the same answer, at the
 * cost of materialising two full node lists. That makes them a measurement of
 * an immutable pair, not a cache of live data. If that reasoning is rejected,
 * the replacement is a view over the two versions and this comment is where to
 * start.
 *
 * `scenes_touched` and `page_count` (migration `0004`) are two more numbers
 * of the same class, and they lean on the same argument. The first is a
 * property of the diff between two frozen snapshots, exactly as the line
 * counts are - `diffScreenplays` in `@folio/script` returns all three from
 * one pass. The second is the page count of the paper that was handed out:
 * it is stored as issued, so that a later re-ruling of the sheet (open
 * decision 8, or lines per inch again) changes what a *new* revision would
 * count and not what a production office was already given. That is the
 * difference between a cache of live data and a record of an artefact, and
 * it is the same reason the revision's date is stored rather than recomputed.
 *
 * `version_id` is what makes the paper reproducible: a revision points at the
 * exact snapshot it was cut from.
 *
 * The colour sequence itself stops at green. `nextRevisionColour('green')`
 * refuses, because AGENTS.md names five and puts changing the sequence behind
 * an explicit decision. A production reaching a sixth revision is a real thing
 * that will happen and it needs a ruling, not a default - so this table can
 * hold only the five, by enum, and that is the constraint doing its job rather
 * than a gap.
 */
export const revisions = pgTable(
  'revisions',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    /** 1-based within an episode. The colour sequence follows this, not the clock. */
    ordinal: integer('ordinal').notNull(),
    colour: revisionColourEnum('colour').notNull(),
    label: text('label').notNull(),
    note: text('note'),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    linesAdded: integer('lines_added').notNull().default(0),
    linesDeleted: integer('lines_deleted').notNull().default(0),
    /** Scenes with at least one changed line since the revision before. */
    scenesTouched: integer('scenes_touched').notNull().default(0),
    /** Pages as issued. See the header: a record of the paper, not a cache. */
    pageCount: integer('page_count').notNull().default(0),
    /** Once true, the pages of this revision keep their numbers forever. */
    locked: boolean('locked').notNull().default(false),
    versionId: uuid('version_id').references(() => versions.id, { onDelete: 'set null' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('revisions_episode_ordinal_key').on(table.episodeId, table.ordinal),
    index('revisions_project_idx').on(table.projectId),
    check('revisions_ordinal_positive', sql`${table.ordinal} >= 1`),
    check(
      'revisions_line_counts_not_negative',
      sql`${table.linesAdded} >= 0 AND ${table.linesDeleted} >= 0`,
    ),
    check(
      'revisions_issue_counts_not_negative',
      sql`${table.scenesTouched} >= 0 AND ${table.pageCount} >= 0`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// locked_pages
// ---------------------------------------------------------------------------

/**
 * One page whose number is frozen. AUTHORED.
 *
 * The same shape as `LockedPage` in `@folio/script` - label, anchor, colour -
 * plus the columns storage needs. That package explains the anchor: "Storing
 * 'page 12' alone survives nothing: after an insert upstream, 'page 12' is
 * different paper. So a lock carries the node the page opened on, and
 * repagination asks where that node landed."
 *
 * `label` is text because a page inserted under an earlier lock prints `12A`.
 * `suffixLetters` generates those and `numberPages` consumes them.
 *
 * `anchor_node_id` has `ON DELETE SET NULL` rather than cascade. A lock whose
 * anchor has left the script is not a lock that should vanish - it is the
 * `anchor-missing` issue `numberPages` reports, and AGENTS.md puts changing
 * locked-page behaviour behind an explicit decision. Deleting the row here
 * would be making that decision quietly.
 */
export const lockedPages = pgTable(
  'locked_pages',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    /** As printed. `12`, or `12A` for a page inserted under an earlier lock. */
    label: text('label').notNull(),
    /** The node the page opened on when the lock was taken. */
    anchorNodeId: uuid('anchor_node_id').references(() => nodes.id, { onDelete: 'set null' }),
    colour: revisionColourEnum('colour').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.label] }),
    index('locked_pages_project_idx').on(table.projectId),
    index('locked_pages_anchor_idx').on(table.anchorNodeId),
    check('locked_pages_label_not_empty', sql`length(btrim(${table.label})) > 0`),
  ],
)
