import { BIBLE_ENTRY_KINDS, BIBLE_ENTRY_STATUSES, BIBLE_SECTIONS } from '@folio/script'
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAtColumn, idColumn, projectIdColumn, updatedAtColumn } from './columns'
import { projects, users } from './tenancy'

/**
 * The bible. Five tables, all AUTHORED.
 *
 * The brief: "Authored entries whose facts cite derived scenes." Nothing in
 * this file is a function of the node list and no derivation pass writes
 * any of it. What *is* derived - a glossary term's use count and first-use
 * scene, whether a cite or a conflict still names a scene in the draft - is
 * computed at read (`@folio/script`'s `bible.ts`) and stored nowhere, as
 * AGENTS.md's "nothing is stored that can be computed" requires.
 *
 * ## Status is a permission, and it is a column the context builder reads
 *
 * `bible_entries.status` is the first of the two context gates: "`canon` is
 * checked against every draft and readable by lenses; `draft` is neither
 * until promoted; `retired` is kept for history and ignored. Enforce this
 * server-side in the context builder." The enum is the pure core's
 * `BIBLE_ENTRY_STATUSES`, whose first value - `draft` - is the column default:
 * nothing is canon until the writer marks it. `repositories/bible.ts`'s
 * `listCanonFacts` is the read a context builder may use, and it filters on
 * this column in SQL.
 *
 * ## Cites and conflicts point at heading nodes with no foreign key
 *
 * `bible_facts.cites` and `bible_facts.conflict_scene_node_id` hold scene
 * heading node ids, on the pattern of `characters.key_lines`, `shots` and
 * `character_arc_turns`: no foreign key, so a heading brought back by undo
 * finds its cite, and a scene the script has lost is dropped on read rather
 * than cascading a fact away. A conflict is a scene and a note together -
 * the check constraint says one without the other is not a conflict.
 *
 * ## The Pitch is one row of `bible_entries`
 *
 * "A separate Pitch entry is ordered key/value fields ... deliberately kept
 * apart from the rules." Kind `pitch`, one per project (a partial unique
 * index), its fields in `bible_pitch_fields` and never in `bible_facts`. It
 * shares the entries table because the nav lists it in a section, it has a
 * status, and it has open questions like any entry; it differs in what
 * hangs off it, and the kind says which.
 *
 * ## Glossary terms are unique by spelling, case-folded
 *
 * A term the audience has to learn is one term however it is capitalised;
 * `bible_terms` refuses `Chawl` beside `chawl`. The use count is not here.
 */

export const bibleSectionEnum = pgEnum('bible_section', BIBLE_SECTIONS)
export const bibleEntryStatusEnum = pgEnum('bible_entry_status', BIBLE_ENTRY_STATUSES)
export const bibleEntryKindEnum = pgEnum('bible_entry_kind', BIBLE_ENTRY_KINDS)

export const bibleEntries = pgTable(
  'bible_entries',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    section: bibleSectionEnum('section').notNull(),
    kind: bibleEntryKindEnum('kind').notNull().default('rules'),
    /** The first context gate. Defaults to the first value: `draft`. */
    status: bibleEntryStatusEnum('status').notNull().default(BIBLE_ENTRY_STATUSES[0]),
    title: text('title').notNull(),
    lede: text('lede'),
    notes: text('notes'),
    /** Order within the section. */
    position: integer('position').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('bible_entries_project_section_position_idx').on(table.projectId, table.section, table.position),
    /** One Pitch per project. */
    uniqueIndex('bible_entries_one_pitch_idx')
      .on(table.projectId)
      .where(sql`kind = 'pitch'`),
    check('bible_entries_title_not_empty', sql`length(btrim(${table.title})) > 0`),
    check('bible_entries_position_not_negative', sql`${table.position} >= 0`),
  ],
)

export const bibleFacts = pgTable(
  'bible_facts',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => bibleEntries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    text: text('text').notNull(),
    /** Scene heading node ids, in the writer's order. No foreign key - see the header. */
    cites: uuid('cites').array().notNull().default(sql`ARRAY[]::uuid[]`),
    /** The scene the writer says contradicts this rule. No foreign key. */
    conflictSceneNodeId: uuid('conflict_scene_node_id'),
    /** What the scene says that the rule forbids. */
    conflictNote: text('conflict_note'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('bible_facts_entry_position_idx').on(table.entryId, table.position),
    index('bible_facts_project_idx').on(table.projectId),
    check('bible_facts_text_not_empty', sql`length(btrim(${table.text})) > 0`),
    check('bible_facts_position_not_negative', sql`${table.position} >= 0`),
    /** A conflict is a scene and a note, or nothing. */
    check(
      'bible_facts_conflict_whole',
      sql`(${table.conflictSceneNodeId} IS NULL) = (${table.conflictNote} IS NULL)`,
    ),
  ],
)

export const bibleQuestions = pgTable(
  'bible_questions',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => bibleEntries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    text: text('text').notNull(),
    /** "Open questions each with an author." The person who asked. */
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    resolved: boolean('resolved').notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('bible_questions_entry_position_idx').on(table.entryId, table.position),
    index('bible_questions_project_idx').on(table.projectId),
    check('bible_questions_text_not_empty', sql`length(btrim(${table.text})) > 0`),
    check('bible_questions_position_not_negative', sql`${table.position} >= 0`),
  ],
)

export const biblePitchFields = pgTable(
  'bible_pitch_fields',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => bibleEntries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    key: text('key').notNull(),
    value: text('value').notNull().default(''),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('bible_pitch_fields_entry_position_idx').on(table.entryId, table.position),
    index('bible_pitch_fields_project_idx').on(table.projectId),
    check('bible_pitch_fields_key_not_empty', sql`length(btrim(${table.key})) > 0`),
    check('bible_pitch_fields_position_not_negative', sql`${table.position} >= 0`),
  ],
)

export const bibleTerms = pgTable(
  'bible_terms',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    definition: text('definition').notNull().default(''),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('bible_terms_project_term_key').on(table.projectId, sql`lower(${table.term})`),
    check('bible_terms_term_not_empty', sql`length(btrim(${table.term})) > 0`),
  ],
)
