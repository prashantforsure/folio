import { z } from 'zod'

import { RevisionColourSchema } from './enums'
import {
  DocumentIdSchema,
  EpisodeIdSchema,
  NodeIdSchema,
  ProjectIdSchema,
  RevisionIdSchema,
  UserIdSchema,
  VersionIdSchema,
} from './ids'
import { TimestampSchema } from './primitives'

/**
 * Two histories that are not the same history.
 *
 * This is the distinction the brief for this phase asks for by name, and it is
 * worth stating plainly because the two look alike from a distance and the
 * damage from conflating them is invisible until a production office is holding
 * paper.
 *
 * **A version is an editor concern.** It is the undo-history backstop: a
 * snapshot of a document so that a bad afternoon, a bad paste or a bad agent
 * run can be walked back. It is cheap, it is frequent, it is nobody's artefact,
 * and it can be pruned. AGENTS.md, Constraints: there is no realtime collab, so
 * conflict handling is "last-write-wins with a conflict banner" - and a version
 * is what makes losing that race survivable.
 *
 * **A revision is a production artefact.** It is a coloured draft that goes out
 * to a crew: White, then Blue, then Pink, then Yellow, then Green. It has an
 * author, a note, tags, a count of what changed, and a locked flag. Its pages
 * must not renumber - AGENTS.md, Pagination and the sheet: "**Locked pages must
 * not renumber.** That is the entire point of the colour system." It is never
 * pruned, because it is a record of what a specific set of people were handed
 * on a specific day.
 *
 * If these were one table, either versions would be too expensive to take often
 * enough to be an undo backstop, or revisions would be pruned and the
 * production record would develop holes. Two tables.
 */

// ---------------------------------------------------------------------------
// Versions - the editor's backstop
// ---------------------------------------------------------------------------

/**
 * A snapshot of one document.
 *
 * `nodeCount` is stored rather than counted from the snapshot on read, and it
 * is the one place in this package where that needs defending. It is not a
 * derived cache of live data: a snapshot is immutable, so the count is a
 * property of a frozen artefact and cannot drift from it. It exists so the
 * version list can render without deserialising a feature-length node list per
 * row.
 *
 * `reason` says what took the snapshot. An agent run takes one before it
 * writes, which is what makes "revert this run" a single operation rather than
 * a reverse-diff.
 */
export const VersionSchema = z.object({
  id: VersionIdSchema,
  projectId: ProjectIdSchema,
  documentId: DocumentIdSchema,
  /** Monotonic within a document. Not a global sequence. */
  ordinal: z.int().min(1),
  reason: z.enum(['autosave', 'manual', 'before_agent_run', 'before_import', 'before_rename']),
  nodeCount: z.int().min(0),
  createdBy: UserIdSchema.nullable(),
  createdAt: TimestampSchema,
})

export type Version = z.infer<typeof VersionSchema>

/** A version with its payload: the whole node list, as the pure core reads it. */
export const VersionSnapshotSchema = z.object({
  version: VersionSchema,
  /** The document at that moment. Validated by `@folio/script`, not here. */
  document: z.unknown(),
})

export type VersionSnapshot = z.infer<typeof VersionSnapshotSchema>

// ---------------------------------------------------------------------------
// Revisions - the production artefact
// ---------------------------------------------------------------------------

/**
 * A coloured production draft.
 *
 * `colour` comes from `@folio/script`'s `REVISION_COLOURS`, in that package
 * because "a production office reads a colour off a physical page; it is a
 * property of the revision, the same way a page number is a property of the
 * measurement" (`revision.ts`). It must never be re-expressed as a palette
 * token - AGENTS.md, UI fidelity: revision colours "must survive a theme switch
 * intact", and a themed salmon page is a wrong page.
 *
 * `linesAdded` and `linesDeleted` are stored, and this is the second place in
 * the package that needs defending against "nothing is stored that can be
 * computed". They are a property of the diff between this revision and the one
 * before it - both of which are frozen - so recomputing them can only ever
 * produce the same answer, at the cost of materialising two full node lists.
 * They are a measurement of an immutable pair, not a cache of live data. If
 * that reasoning is rejected, the fix is a view over the two snapshots and this
 * comment is where to start.
 *
 * `locked` is the flag that stops renumbering. Which pages are locked is
 * `LockedPageSchema` below, because a lock is per page and per anchor.
 */
export const RevisionSchema = z.object({
  id: RevisionIdSchema,
  projectId: ProjectIdSchema,
  episodeId: EpisodeIdSchema,
  /** 1-based within an episode. The colour sequence follows this, not the clock. */
  ordinal: z.int().min(1),
  colour: RevisionColourSchema,
  /** What the office calls it. "Production Draft", "Rev. Blue". */
  label: z.string().trim().min(1).max(120),
  /** The circulated note. Free text, and it goes out with the paper. */
  note: z.string().max(4_000).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(24),
  linesAdded: z.int().min(0),
  linesDeleted: z.int().min(0),
  /** Once true, the pages of this revision keep their numbers forever. */
  locked: z.boolean(),
  /** The version this revision was cut from, so the paper is reproducible. */
  versionId: VersionIdSchema.nullable(),
  authorId: UserIdSchema.nullable(),
  createdAt: TimestampSchema,
})

export type Revision = z.infer<typeof RevisionSchema>

/**
 * One page whose number is frozen.
 *
 * The same shape as `LockedPage` in `@folio/script` - `{ label, anchor,
 * revision }` - plus the rows storage needs. That package's header explains the
 * anchor: "Storing 'page 12' alone survives nothing: after an insert upstream,
 * 'page 12' is different paper. So a lock carries the node the page opened on,
 * and repagination asks where that node landed."
 *
 * `label` is a string and not an integer because a page inserted under an
 * earlier lock prints as `12A`. `suffixLetters` in `@folio/script` generates
 * those and `numberPages` consumes them.
 */
export const LockedPageSchema = z.object({
  projectId: ProjectIdSchema,
  revisionId: RevisionIdSchema,
  /** The number as printed. `12`, or `12A` for an inserted page. */
  label: z.string().trim().min(1).max(16),
  /** The node the page opened on when the lock was taken. */
  anchor: NodeIdSchema,
  colour: RevisionColourSchema,
})

export type LockedPage = z.infer<typeof LockedPageSchema>
