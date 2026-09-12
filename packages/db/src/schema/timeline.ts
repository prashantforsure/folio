import { STORY_THREAD_COLOURS } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

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
