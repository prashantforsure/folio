import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { idColumn, projectIdColumn, timestampColumn } from './columns'
import { documents, nodes } from './documents'
import { episodes, pageModeEnum, projects, revisionColourEnum, scriptFormatEnum } from './tenancy'

/**
 * Measurement records. The only place in this schema a page number may live.
 *
 * AGENTS.md, exception table "Nothing is stored that can be computed - except":
 * page number and eighths, "because client, print and export must agree, and
 * recompute is expensive", stored "on a **measurement record**. Never a node
 * attribute."
 *
 * Everything here is classified **measurement** - not authored, not a derived
 * entity cache. The distinction decides what may overwrite it: a derived cache
 * is rebuilt by `derive`, a measurement is rebuilt by `paginate`, and neither
 * may touch the other's rows or any authored row.
 *
 * ## Why four tables and not one JSON column
 *
 * `paginate` returns one `MeasurementRecord` and it would serialise fine. But
 * the questions asked of it are per-scene and per-page - the Scenes route wants
 * a start page and an eighths figure per scene, Production schedules by them -
 * and answering those from a blob means loading a feature's worth of layout to
 * read forty numbers.
 *
 * What stays as JSON is a node's `runs` and a page's `artefacts`. Nothing
 * queries either; the renderer takes all of them or none. A table for them
 * would be rows nobody selects.
 *
 * ## The direction of every reference here
 *
 * These rows point **at** node ids. No node points back. That asymmetry is the
 * schema-level statement of the rule: a node cannot learn its page number
 * without somebody adding a column to the wrong table, which is a migration a
 * reviewer sees.
 */

// `scriptFormatEnum` (`script_format`) and `pageModeEnum` (`page_mode`) live in `tenancy.ts`,
// because `projects` carries both and this file imports that one. Same Postgres types.

/**
 * One pagination pass. MEASUREMENT.
 *
 * `page_mode` and `live_repaginate` are carried because AGENTS.md's exception
 * table makes them per-project settings rather than URL state, and a consumer
 * has to see what produced the record it is holding.
 * `docs/build-decisions.md` records why they are two columns and not a
 * three-value enum: `liveRepaginate` "is a cadence flag: it changes nothing but
 * its own field", so it cannot be a peer of `paged` and `continuous`.
 *
 * `node_digest` is what makes a stale measurement detectable rather than
 * silently wrong: a hash of the node list the pass ran over. It is a stored
 * hash of an immutable input, not a cache of a live value.
 *
 * `format: 'asian'` will never appear in a row here, because
 * `resolveSheet('asian')` refuses - AGENTS.md open decision 8, the A4 sheet
 * width, is unruled and the engine will not guess it. The enum still admits the
 * value because the format is an engine *input*; what refuses is upstream.
 */
export const measurements = pgTable(
  'measurements',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    format: scriptFormatEnum('format').notNull(),
    pageMode: pageModeEnum('page_mode').notNull(),
    liveRepaginate: boolean('live_repaginate').notNull().default(false),
    /** The resolved `SheetSpec`. Read whole or not at all. */
    sheet: jsonb('sheet').notNull(),
    totalPages: integer('total_pages').notNull(),
    totalLines: integer('total_lines').notNull(),
    totalScenes: integer('total_scenes').notNull(),
    totalEighths: integer('total_eighths').notNull(),
    /** Hash of the measured node list. Mismatch means stale. */
    nodeDigest: text('node_digest').notNull(),
    computedAt: timestampColumn('computed_at').notNull().defaultNow(),
  },
  (table) => [
    index('measurements_project_idx').on(table.projectId),
    /**
     * One current measurement per document, format and mode.
     *
     * Not a history: a superseded measurement answers nothing a fresh one does
     * not, and keeping every pass would grow faster than the script. What is
     * kept for the record is the *revision*, which is a different table.
     */
    uniqueIndex('measurements_document_format_mode_key').on(
      table.documentId,
      table.format,
      table.pageMode,
    ),
    check(
      'measurements_totals_not_negative',
      sql`${table.totalPages} >= 0 AND ${table.totalLines} >= 0
          AND ${table.totalScenes} >= 0 AND ${table.totalEighths} >= 0`,
    ),
  ],
)

/**
 * One measured page. MEASUREMENT.
 *
 * `label` is separate from `ordinal` for the reason it is in `history.ts`: a
 * page inserted under a lock prints `12A` while being the thirteenth sheet.
 */
export const measurementPages = pgTable(
  'measurement_pages',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    measurementId: uuid('measurement_id')
      .notNull()
      .references(() => measurements.id, { onDelete: 'cascade' }),
    /** 1-based physical position. */
    ordinal: integer('ordinal').notNull(),
    /** As printed. `12`, `12A`. */
    label: text('label').notNull(),
    locked: boolean('locked').notNull().default(false),
    colour: revisionColourEnum('colour').notNull(),
    linesUsed: integer('lines_used').notNull(),
    /** The node the page opens on. Null when it opens mid-node. */
    firstNodeId: uuid('first_node_id').references(() => nodes.id, { onDelete: 'set null' }),
    /** `(MORE)` and `(CONT'D)` placements. Layout artefacts, never node content. */
    artefacts: jsonb('artefacts').notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [
    primaryKey({ columns: [table.measurementId, table.ordinal] }),
    index('measurement_pages_project_idx').on(table.projectId),
    check('measurement_pages_ordinal_positive', sql`${table.ordinal} >= 1`),
  ],
)

/**
 * A scene's extent on the sheet. MEASUREMENT.
 *
 * This is the row the Scenes route and the Production breakdown read, and it is
 * why the record decomposes at all.
 *
 * `scene_node_id` is the heading node's id, matching `SceneRecord.id` in
 * `@folio/script`. Eighths are an integer count; the `2/8` display form is
 * computed by that package's `formatEighths` and is never a column.
 *
 * Eighths are computed in `continuous` mode too - `docs/build-decisions.md`: "a
 * scene's length in eighths is a property of the sheet, not of whether the
 * breaks are drawn."
 */
export const measurementScenes = pgTable(
  'measurement_scenes',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    measurementId: uuid('measurement_id')
      .notNull()
      .references(() => measurements.id, { onDelete: 'cascade' }),
    sceneNodeId: uuid('scene_node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    /** 1-based scene number in document order, as this pass saw it. */
    number: integer('number').notNull(),
    startPage: integer('start_page').notNull(),
    endPage: integer('end_page').notNull(),
    lines: integer('lines').notNull(),
    eighths: integer('eighths').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.measurementId, table.sceneNodeId] }),
    index('measurement_scenes_project_idx').on(table.projectId),
    index('measurement_scenes_number_idx').on(table.measurementId, table.number),
    check(
      'measurement_scenes_pages_ordered',
      sql`${table.startPage} >= 1 AND ${table.endPage} >= ${table.startPage}`,
    ),
    check(
      'measurement_scenes_counts_not_negative',
      sql`${table.lines} >= 0 AND ${table.eighths} >= 0`,
    ),
  ],
)

/**
 * Where one node landed. MEASUREMENT.
 *
 * `runs` is the per-line placement, as JSON. The renderer reads all of it; no
 * query filters on it.
 */
export const measurementNodes = pgTable(
  'measurement_nodes',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    measurementId: uuid('measurement_id')
      .notNull()
      .references(() => measurements.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    firstPage: integer('first_page').notNull(),
    lastPage: integer('last_page').notNull(),
    lines: integer('lines').notNull(),
    /** `PlacedRun[]`. Read whole by the renderer, queried by nothing. */
    runs: jsonb('runs').notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [
    primaryKey({ columns: [table.measurementId, table.nodeId] }),
    index('measurement_nodes_project_idx').on(table.projectId),
    check(
      'measurement_nodes_pages_ordered',
      sql`${table.firstPage} >= 1 AND ${table.lastPage} >= ${table.firstPage}`,
    ),
    check('measurement_nodes_lines_not_negative', sql`${table.lines} >= 0`),
  ],
)
