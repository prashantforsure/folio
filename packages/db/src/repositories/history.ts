import type {
  EpisodeId,
  LockedPage,
  Revision,
  RevisionId,
  UserId,
  Version,
  VersionId,
} from '@folio/contracts'
import { projectId as brandProjectId } from '@folio/contracts'
import { isErr, nextRevisionColour } from '@folio/script'
import type { DocumentId, NodeId, RevisionColour } from '@folio/script'
import { asc, desc, eq } from 'drizzle-orm'

import { lockedPages, revisions, versions } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * Versions and revisions - and they stay apart in here too.
 *
 * See `../schema/history.ts` for why they are two tables. The consequence for
 * this file is that there is no function taking either: `snapshotVersion` and
 * `cutRevision` are different operations with different lifetimes, and a
 * "saveHistory" that dispatched on a flag would be the first step back to one
 * table.
 */

/**
 * The header of a version row.
 *
 * Structurally a version row minus `snapshot`, so the list query - which
 * deliberately does not select a feature-length node list per row - and the
 * insert path can share one mapper.
 */
type VersionHeaderRow = Omit<typeof versions.$inferSelect, 'snapshot'>

const toVersion = (row: VersionHeaderRow): Version => ({
  id: row.id as VersionId,
  projectId: brandProjectId(row.projectId),
  documentId: row.documentId as DocumentId,
  ordinal: row.ordinal,
  reason: row.reason,
  nodeCount: row.nodeCount,
  createdBy: row.createdBy === null ? null : (row.createdBy as UserId),
  createdAt: stamp(row.createdAt),
})

const toRevision = (row: typeof revisions.$inferSelect): Revision => ({
  id: row.id as RevisionId,
  projectId: brandProjectId(row.projectId),
  episodeId: row.episodeId as EpisodeId,
  ordinal: row.ordinal,
  colour: row.colour,
  label: row.label,
  note: row.note,
  tags: row.tags,
  linesAdded: row.linesAdded,
  linesDeleted: row.linesDeleted,
  locked: row.locked,
  versionId: row.versionId === null ? null : (row.versionId as VersionId),
  authorId: row.authorId === null ? null : (row.authorId as UserId),
  createdAt: stamp(row.createdAt),
})

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/**
 * Take a snapshot.
 *
 * The ordinal is read and incremented inside the transaction, so two concurrent
 * autosaves cannot both take the same number - the unique index would reject
 * the second, which is the intended outcome rather than a bug to work around.
 */
export const snapshotVersion = async (
  scope: ProjectScope,
  documentId: DocumentId,
  reason: Version['reason'],
  snapshot: unknown,
  nodeCount: number,
): Promise<Version> => {
  return dbOf(scope).transaction(async (tx) => {
    const latest = await tx
      .select({ ordinal: versions.ordinal })
      .from(versions)
      .where(scoped(scope, versions, eq(versions.documentId, documentId)))
      .orderBy(desc(versions.ordinal))
      .limit(1)
    const ordinal = (latest[0]?.ordinal ?? 0) + 1
    const inserted = await tx
      .insert(versions)
      .values({
        ...tenant(scope),
        documentId,
        ordinal,
        reason,
        snapshot,
        nodeCount,
        createdBy: scope.actor,
      })
      .returning()
    const row = inserted[0]
    if (row === undefined) {
      throw new Error('Folio: inserting a version returned no row. This is a bug in the repository.')
    }
    return toVersion(row)
  })
}

/** The version list, newest first. Headers only - the snapshot is not selected. */
export const listVersions = async (
  scope: ProjectScope,
  documentId: DocumentId,
  limit = 50,
): Promise<readonly Version[]> => {
  const rows = await dbOf(scope)
    .select({
      id: versions.id,
      projectId: versions.projectId,
      documentId: versions.documentId,
      ordinal: versions.ordinal,
      reason: versions.reason,
      nodeCount: versions.nodeCount,
      createdBy: versions.createdBy,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .where(scoped(scope, versions, eq(versions.documentId, documentId)))
    .orderBy(desc(versions.ordinal))
    .limit(limit)
  return rows.map(toVersion)
}

/** One snapshot's payload. Validated by `@folio/script`'s reader at the caller. */
export const readVersionSnapshot = async (
  scope: ProjectScope,
  versionId: VersionId,
): Promise<unknown | null> => {
  const rows = await dbOf(scope)
    .select({ snapshot: versions.snapshot })
    .from(versions)
    .where(scoped(scope, versions, eq(versions.id, versionId)))
    .limit(1)
  return rows[0]?.snapshot ?? null
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

export const listRevisions = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
): Promise<readonly Revision[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(revisions)
    .where(scoped(scope, revisions, eq(revisions.episodeId, episodeId)))
    .orderBy(asc(revisions.ordinal))
  return rows.map(toRevision)
}

/**
 * Cut the next coloured draft.
 *
 * The colour comes from `@folio/script`'s `nextRevisionColour`, which
 * **refuses** past green: AGENTS.md names five colours and puts changing the
 * sequence behind an explicit decision, so a sixth invented here would be a
 * product decision taken in a commit. The refusal surfaces as a thrown error
 * with the pure core's own wording, because a production that has reached a
 * sixth revision needs a human, not a fallback.
 *
 * AGENTS.md, The AI agent: "One run produces one revision entry." This is that
 * entry, and it is why `versionId` is carried - the paper has to be
 * reproducible from the snapshot it was cut from.
 */
export const cutRevision = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  input: {
    readonly label: string
    readonly note: string | null
    readonly tags: readonly string[]
    readonly linesAdded: number
    readonly linesDeleted: number
    readonly versionId: VersionId | null
  },
): Promise<Revision> => {
  return dbOf(scope).transaction(async (tx) => {
    const latest = await tx
      .select({ ordinal: revisions.ordinal, colour: revisions.colour })
      .from(revisions)
      .where(scoped(scope, revisions, eq(revisions.episodeId, episodeId)))
      .orderBy(desc(revisions.ordinal))
      .limit(1)
    const previous = latest[0]
    const colour = nextColour(previous?.colour ?? null)
    const inserted = await tx
      .insert(revisions)
      .values({
        ...tenant(scope),
        episodeId,
        ordinal: (previous?.ordinal ?? 0) + 1,
        colour,
        label: input.label,
        note: input.note,
        tags: [...input.tags],
        linesAdded: input.linesAdded,
        linesDeleted: input.linesDeleted,
        locked: false,
        versionId: input.versionId,
        authorId: scope.actor,
      })
      .returning()
    const row = inserted[0]
    if (row === undefined) {
      throw new Error('Folio: inserting a revision returned no row. This is a bug in the repository.')
    }
    return toRevision(row)
  })
}

/** White for the first revision; the pure core's sequence after that. */
const nextColour = (previous: RevisionColour | null): RevisionColour => {
  if (previous === null) return 'white'
  const next = nextRevisionColour(previous)
  if (isErr(next)) throw new Error(`Folio: ${next.error.detail}`)
  return next.value
}

/**
 * Lock a revision's pages.
 *
 * AGENTS.md, Pagination and the sheet: "**Locked pages must not renumber.**
 * That is the entire point of the colour system", and When to ask first puts
 * changing that behaviour behind an explicit decision. So this writes the locks
 * and nothing more - it does not renumber, does not resolve collisions and does
 * not decide what happens past the last lock. `numberPages` in `@folio/script`
 * reads these rows and reports `lockIssues` rather than repairing them.
 */
export const lockRevision = async (
  scope: ProjectScope,
  revisionId: RevisionId,
  pages: readonly { readonly label: string; readonly anchor: NodeId | null; readonly colour: RevisionColour }[],
): Promise<void> => {
  await dbOf(scope).transaction(async (tx) => {
    await tx.update(revisions).set({ locked: true }).where(scoped(scope, revisions, eq(revisions.id, revisionId)))
    if (pages.length === 0) return
    await tx
      .insert(lockedPages)
      .values(
        pages.map((page) => ({
          ...tenant(scope),
          revisionId,
          label: page.label,
          anchorNodeId: page.anchor,
          colour: page.colour,
        })),
      )
      .onConflictDoNothing({ target: [lockedPages.revisionId, lockedPages.label] })
  })
}

export const listLockedPages = async (
  scope: ProjectScope,
  revisionId: RevisionId,
): Promise<readonly LockedPage[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(lockedPages)
    .where(scoped(scope, lockedPages, eq(lockedPages.revisionId, revisionId)))
    .orderBy(asc(lockedPages.label))
  return rows.map((row) => ({
    projectId: brandProjectId(row.projectId),
    revisionId: row.revisionId as RevisionId,
    label: row.label,
    anchor: (row.anchorNodeId ?? '') as NodeId,
    colour: row.colour,
  }))
}
