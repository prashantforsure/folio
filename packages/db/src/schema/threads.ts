import { THREAD_ANCHOR_KINDS, THREAD_STATES } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import {
  createdAtColumn,
  idColumn,
  projectIdColumn,
  timestampColumn,
  updatedAtColumn,
} from './columns'
import { nodes } from './documents'
import { projects, users } from './tenancy'

/**
 * Comment threads, anchored by id and only by id.
 *
 * AGENTS.md, The AI agent: proposals "are anchored to node ids and rendered as
 * hunks against current node state." A comment works the same way, and
 * `docs/adr/0001-node-identity.md` names the failure to design against: an
 * anchor that moves "does not fail loudly - it silently re-points a reviewer's
 * comment at somebody else's line", and the system to avoid is one that, having
 * lost an id, "starts anchoring comments by text offset or by matching prose."
 *
 * So there is no offset column, no quoted-text column and no line number in
 * this file. When an anchor id is retired, `node_tombstones` says whether it was
 * merged into a survivor, and a detached thread is a designed state - the same
 * way `0 appearances - record kept` is designed for a character.
 */

export const threadAnchorKindEnum = pgEnum('thread_anchor_kind', THREAD_ANCHOR_KINDS)
export const threadStateEnum = pgEnum('thread_state', THREAD_STATES)

/**
 * A comment thread. AUTHORED.
 *
 * ## Four anchor kinds, two columns
 *
 * The brief asks for a discriminated union of four from the start, and it is
 * modelled as four even though storyboard shots do not exist yet - widening a
 * union after rows exist is the expensive direction, and the fourth variant is
 * free today.
 *
 * Three of the four resolve to a `nodes` row: a script node is a screenplay
 * node, and a beat and an outline block are both outline nodes. They therefore
 * share one foreign key column rather than getting three separate ones - three
 * keys into the same table would be three indexes and three constraints saying
 * the same thing, and the discriminator already records which is meant.
 *
 * The discriminator is not redundant with the column. It says what the writer
 * thinks they annotated, which is what the Notes inbox groups by, and it is the
 * thing that keeps working when a shot becomes a row of its own and
 * `anchor_shot_id` stops being an orphan.
 *
 * `anchor_shot_id` deliberately has **no foreign key**. There is no table to
 * point at. That is a documented placeholder, not an oversight, and closing it
 * is one forward migration.
 *
 * The check constraint is what makes the union real in the database: exactly
 * one anchor column is non-null, and which one is decided by the kind.
 */
export const commentThreads = pgTable(
  'comment_threads',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    anchorKind: threadAnchorKindEnum('anchor_kind').notNull(),
    /** Set for script_node, beat and outline_block. Null for storyboard_shot. */
    anchorNodeId: uuid('anchor_node_id').references(() => nodes.id, { onDelete: 'set null' }),
    /** Set for storyboard_shot only. No FK: shots are not a table yet. */
    anchorShotId: uuid('anchor_shot_id'),
    state: threadStateEnum('state').notNull().default('open'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    resolvedAt: timestampColumn('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('comment_threads_project_idx').on(table.projectId),
    index('comment_threads_anchor_node_idx').on(table.anchorNodeId),
    index('comment_threads_state_idx').on(table.projectId, table.state),
    /**
     * The union, enforced. Exactly one anchor, and the kind picks which.
     *
     * Written as two equivalences rather than a `CASE`, so the failure message
     * names the constraint that a bad row actually violated.
     */
    check(
      'comment_threads_anchor_matches_kind',
      sql`(${table.anchorKind} = 'storyboard_shot') = (${table.anchorShotId} IS NOT NULL)
          AND (${table.anchorKind} <> 'storyboard_shot') = (${table.anchorNodeId} IS NOT NULL)`,
    ),
    /**
     * A resolved thread says when it was resolved. An open one says neither.
     *
     * `resolved_by` is deliberately *not* in this constraint: it is
     * `ON DELETE SET NULL`, so a resolved thread whose resolver deleted their
     * account still has its resolution date and is still resolved.
     */
    check(
      'comment_threads_resolution_consistent',
      sql`(${table.state} = 'resolved') = (${table.resolvedAt} IS NOT NULL)`,
    ),
  ],
)

/**
 * One message in a thread. AUTHORED.
 *
 * **Assumption, made here rather than in a footnote:** the design handoff's
 * Appendix A models this as a single `Note { ..., body, status }` with no
 * replies. The brief for this phase asks for "threads", the Notes route is
 * described as an inbox of open/mine/resolved comments, and a thread with one
 * immutable body is not a thread. So the body is split into its own table and a
 * thread can have many. Nobody has specified reply behaviour - whether a reply
 * can be edited, whether the first message is special - and none of that is
 * decided here.
 *
 * **A comment never reaches an export.** AGENTS.md, Export: "Comments never
 * enter an export. Notes never enter an export." That is enforced by the
 * exporter not reading this table, not by a flag on it.
 */
export const threadComments = pgTable(
  'thread_comments',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => commentThreads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    editedAt: timestampColumn('edited_at'),
  },
  (table) => [
    index('thread_comments_thread_idx').on(table.threadId, table.createdAt),
    index('thread_comments_project_idx').on(table.projectId),
    check('thread_comments_body_not_empty', sql`length(btrim(${table.body})) > 0`),
  ],
)
