import { z } from 'zod'

import { PageModeSchema, RevisionColourSchema, ScriptFormatSchema } from './enums'
import {
  DocumentIdSchema,
  EpisodeIdSchema,
  MeasurementIdSchema,
  NodeIdSchema,
  ProjectIdSchema,
} from './ids'
import { TimestampSchema } from './primitives'

/**
 * The measurement record. The only place a page number is allowed to live.
 *
 * AGENTS.md, exception table "Nothing is stored that can be computed - except":
 * page number and eighths are the first exception, "because client, print and
 * export must agree, and recompute is expensive", and the instruction is to
 * "Store on a **measurement record**. Never a node attribute."
 *
 * Everything in this file is therefore classified **measurement** - neither
 * authored nor a derived-entity cache. The distinction matters for what may
 * overwrite it: a derived cache is rebuilt by `derive`, a measurement is
 * rebuilt by `paginate`, and neither may touch the other's rows or any authored
 * row.
 *
 * ## Why it is four schemas and not one JSON blob
 *
 * `paginate` returns one `MeasurementRecord` and it would serialise happily.
 * But the questions asked of it are per-scene and per-page - the Scenes route
 * wants a start page and an eighths figure per scene, Production schedules by
 * them - and answering those from a blob means loading a feature's worth of
 * layout to read forty numbers. So the record decomposes: a header, its pages,
 * its scenes, and its nodes.
 *
 * The one thing that stays as JSON is a node's `runs` - which page each wrapped
 * line landed on. Nothing queries a run; the renderer takes all of them at once
 * or none. A fifth table for it would be rows nobody selects.
 *
 * ## What is not here
 *
 * `format: 'asian'` cannot be measured at all. AGENTS.md open decision 8 - the
 * A4 sheet width - is unruled, and `resolveSheet('asian')` in `@folio/script`
 * refuses rather than guessing. `ScriptFormatSchema` still admits the value
 * because the format is an engine *input* and the column has to be able to hold
 * it; what refuses is the engine, upstream of any row reaching here.
 */

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

/**
 * One pagination pass over one document.
 *
 * `pageMode` and `liveRepaginate` are carried because AGENTS.md's exception
 * table makes them per-project settings rather than URL state, and a consumer
 * has to be able to see what produced the record it is holding.
 * `docs/build-decisions.md` records why they are two fields and not a
 * three-value enum: `liveRepaginate` "is a cadence flag: it changes nothing but
 * its own field", so it cannot be a peer of `paged` and `continuous`.
 *
 * `nodeDigest` is what makes a stale measurement detectable. It is a hash of
 * the node list the pass ran over; if the document has moved on, the digest no
 * longer matches and the record is known-stale rather than silently wrong. This
 * is a **stored hash of an immutable input**, not a cache of a live value.
 */
export const MeasurementSchema = z.object({
  id: MeasurementIdSchema,
  projectId: ProjectIdSchema,
  episodeId: EpisodeIdSchema,
  documentId: DocumentIdSchema,
  format: ScriptFormatSchema,
  pageMode: PageModeSchema,
  liveRepaginate: z.boolean(),
  /** The `SheetSpec` the pass resolved. JSON, because it is read whole or not at all. */
  sheet: z.unknown(),
  totalPages: z.int().min(0),
  totalLines: z.int().min(0),
  totalScenes: z.int().min(0),
  totalEighths: z.int().min(0),
  /** Hash of the node list this pass measured. Mismatch means stale. */
  nodeDigest: z.string().min(16).max(128),
  computedAt: TimestampSchema,
})

export type Measurement = z.infer<typeof MeasurementSchema>

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * One measured page.
 *
 * `label` is separate from `ordinal` for the same reason it is in
 * `history.ts`: a page inserted under a lock prints `12A` while being the
 * thirteenth sheet. `locked` says the label is frozen.
 */
export const MeasurementPageSchema = z.object({
  projectId: ProjectIdSchema,
  measurementId: MeasurementIdSchema,
  /** 1-based physical position. */
  ordinal: z.int().min(1),
  /** As printed. `12`, `12A`. */
  label: z.string().trim().min(1).max(16),
  locked: z.boolean(),
  colour: RevisionColourSchema,
  linesUsed: z.int().min(0),
  /** The node the page opens on. Null for a page that opens mid-node. */
  firstNodeId: NodeIdSchema.nullable(),
  /** `(MORE)` and `(CONT'D)` placements. Layout artefacts, never node content. */
  artefacts: z.unknown(),
})

export type MeasurementPage = z.infer<typeof MeasurementPageSchema>

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/**
 * A scene's extent on the sheet.
 *
 * This is the row the Scenes route and the Production breakdown read, and it is
 * why the record decomposes at all.
 *
 * `sceneNodeId` is the heading node's id, matching `SceneRecord.id` in
 * `@folio/script`. Eighths are stored as an integer count and rendered by that
 * package's `formatEighths` - `2/8`, not a float - so the display form is
 * computed and never a column.
 *
 * Eighths are computed in `continuous` mode too. `docs/build-decisions.md`: "a
 * scene's length in eighths is a property of the sheet, not of whether the
 * breaks are drawn".
 */
export const MeasurementSceneSchema = z.object({
  projectId: ProjectIdSchema,
  measurementId: MeasurementIdSchema,
  sceneNodeId: NodeIdSchema,
  /** 1-based scene number in document order, as this pass saw it. */
  number: z.int().min(1),
  startPage: z.int().min(1),
  endPage: z.int().min(1),
  lines: z.int().min(0),
  eighths: z.int().min(0),
})

export type MeasurementScene = z.infer<typeof MeasurementSceneSchema>

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * Where one node landed.
 *
 * Note the direction of the reference: this row points **at** a node id. The
 * node does not point at this. That asymmetry is the schema-level statement of
 * the rule - a node cannot learn its page number without someone adding a
 * column to the wrong table, which is a migration a reviewer will see.
 */
export const MeasurementNodeSchema = z.object({
  projectId: ProjectIdSchema,
  measurementId: MeasurementIdSchema,
  nodeId: NodeIdSchema,
  firstPage: z.int().min(1),
  lastPage: z.int().min(1),
  lines: z.int().min(0),
  /** `PlacedRun[]`. Read whole by the renderer, queried by nothing. */
  runs: z.unknown(),
})

export type MeasurementNode = z.infer<typeof MeasurementNodeSchema>
