import { CONTINUITY_KINDS, STORY_THREAD_COLOURS } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAtColumn, idColumn, projectIdColumn, updatedAtColumn } from './columns'
import { projects } from './tenancy'

/**
 * The Timeline: story threads. AUTHORED.
 *
 * The brief: "Threads - a named, coloured storyline and the scenes it runs
 * through across episodes. Authored and linked by hand; nothing derives a
 * thread." This table is the storyline; the scenes it runs through are
 * **not here** - they are `scenes.threads` (`derived.ts`), the column
 * declared opaque in `0000` for exactly this, now holding thread ids as
 * text in the writer's order. Putting the link on the scene's authored row
 * is what makes it survive a re-derive for the same reason a synopsis does;
 * a join table would have needed its own guarantee.
 *
 * So there is no foreign key from a scene to a thread and no cascade: a
 * deleted thread's id is removed from every scene in one statement by the
 * repository (`array_remove`), and any id that slips past that is dropped
 * on read, the same rule as `characters.key_lines`.
 *
 * `colour` is a closed enum, one of `@folio/contracts`' `STORY_THREAD_COLOURS`,
 * each a themed token in `packages/ui`. A free hex on a row would be a second
 * place a colour is written, which AGENTS.md forbids.
 *
 * `position` orders the rows of the grid; the route keeps it dense.
 *
 * Story time - the brief's second authored thing - is three columns on
 * `scenes`, not a table: `story_day`, `story_clock`, `flashback`. See that
 * table.
 */

export const storyThreadColourEnum = pgEnum('story_thread_colour', STORY_THREAD_COLOURS)

export const storyThreads = pgTable(
  'story_threads',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colour: storyThreadColourEnum('colour').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('story_threads_project_position_idx').on(table.projectId, table.position),
    check('story_threads_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    check('story_threads_position_not_negative', sql`${table.position} >= 0`),
  ],
)

/**
 * The writer's verdict on a continuity finding. AUTHORED (`0023`, the
 * Timeline rebuild's phase 3).
 *
 * The check itself is `@folio/script`'s `continuity.ts` - eight pure rules
 * over the story time the writer typed and what the page says, run on
 * every read and stored nowhere. What *is* stored is the one thing a
 * function of the node list cannot know: that the writer looked at a
 * finding and said `It's deliberate`. A row here is that answer, keyed on
 * the finding's stable `key` (`kind:scene:other:subject`, the check's
 * own), so it survives every re-read and every re-derive; `Reopen` deletes
 * it. Ruled 2026-09-18: the `character_findings` shape - the kind, the two
 * heading node ids with no key (`shots.scene_node_id`'s convention: a scene
 * that leaves the script leaves its verdict unmatched, and unmatched is
 * invisible) and the subject (a character or thread id) beside the key,
 * so a row reads as what it is about. One column fewer than that shape:
 * no `status`, because a row *is* the verdict - the only status a row
 * could have is `deliberate`, and a column with one value is a column.
 */
export const continuityKindEnum = pgEnum('timeline_finding_kind', CONTINUITY_KINDS)

export const timelineFindings = pgTable(
  'timeline_findings',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    kind: continuityKindEnum('kind').notNull(),
    /** The check's stable key for the finding; what the route matches on. */
    key: text('key').notNull(),
    /** The scene the finding is about. Heading node id, no key. */
    aRef: uuid('a_ref').notNull(),
    /** The scene it was measured against, when there is one. */
    bRef: uuid('b_ref'),
    /** A character or thread id, for the kinds about one. Text: the two id spaces share this column. */
    subject: text('subject'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('timeline_findings_project_idx').on(table.projectId),
    uniqueIndex('timeline_findings_key').on(table.projectId, table.key),
    check('timeline_findings_key_not_empty', sql`length(btrim(${table.key})) > 0`),
  ],
)
