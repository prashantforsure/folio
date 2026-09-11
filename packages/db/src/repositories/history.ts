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
import { asc, desc, eq, inArray } from 'drizzle-orm'

import { episodes, lockedPages, nodeTombstones, revisions, versions } from '../schema'
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
 *
 * ## Restore lives in `apps/web`, and one piece of it is here
 *
 * "Restore creates a new version. It never destroys history." The route's
 * server action is the sequence - snapshot the document as it stands, write
 * the restored list, snapshot again - and it goes through `reconcileNodes`,
 * which writes only the rows that changed and so keeps every surviving
 * node's row, and with it every anchor pointing at it. The one thing that
 * path cannot do on its own is bring back a node that was deleted since the
 * draft was cut: its id is tombstoned, and `reconcileNodes` refuses a
 * tombstoned id, correctly, as reuse. `reviveNodeIds` below is the explicit
 * lift, and its header says why it is not reuse.
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
  scenesTouched: row.scenesTouched,
  pageCount: row.pageCount,
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

/** One version's header, or null. The snapshot is not selected. */
export const readVersion = async (
  scope: ProjectScope,
  versionId: VersionId,
): Promise<Version | null> => {
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
    .where(scoped(scope, versions, eq(versions.id, versionId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toVersion(row)
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

/**
 * Lift the tombstones on ids a restore is bringing back.
 *
 * ADR 0001, Q4, is the whole argument: "Is a deleted node's id retired
 * permanently? Undo has to restore it, so yes in practice - which means
 * delete is a tombstone, and an id is never reused." The tombstone exists
 * *so that* the node can come back as itself. A restore is undo at the scale
 * of a draft: the node that returns is the node that left - same text, same
 * identity - so a later diff against any draft joins it to itself, and its
 * provenance and every measurement that named it still name it. Minting a
 * fresh id instead would make every restored line a stranger to its own
 * history.
 *
 * Reuse - the thing the ADR forbids - is a *different* node taking an old id.
 * This is the same node taking its own. The two are told apart by the
 * caller: a restore only revives ids that appear in the snapshot it is
 * restoring, and a snapshot is immutable.
 *
 * What this does not do: re-anchor a comment thread. `comment_threads.
 * anchor_node_id` was set to null by the foreign key when the node row went,
 * and a nulled anchor is the *detached* state ADR 0001 Q4 leaves as a product
 * decision. Reviving the id does not reach back into that table.
 *
 * Scoped, like everything here, and a no-op for ids with no tombstone.
 */
export const reviveNodeIds = async (scope: ProjectScope, ids: readonly NodeId[]): Promise<void> => {
  if (ids.length === 0) return
  await dbOf(scope)
    .delete(nodeTombstones)
    .where(scoped(scope, nodeTombstones, inArray(nodeTombstones.nodeId, [...ids])))
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

export const readRevision = async (
  scope: ProjectScope,
  revisionId: RevisionId,
): Promise<Revision | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(revisions)
    .where(scoped(scope, revisions, eq(revisions.id, revisionId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toRevision(row)
}

/**
 * What the next revision of an episode would be, without cutting it.
 *
 * The Revisions route's "Issue revision" form shows the colour before the
 * writer commits, and refuses in the same place the cut would: past green
 * there is no next colour (open decision, `docs/build-decisions.md`), and a
 * form that only found that out on submit would be a form that lies.
 */
export const previewNextRevision = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
): Promise<
  | { readonly ok: true; readonly ordinal: number; readonly colour: RevisionColour }
  | { readonly ok: false; readonly after: RevisionColour; readonly detail: string }
> => {
  const latest = await dbOf(scope)
    .select({ ordinal: revisions.ordinal, colour: revisions.colour })
    .from(revisions)
    .where(scoped(scope, revisions, eq(revisions.episodeId, episodeId)))
    .orderBy(desc(revisions.ordinal))
    .limit(1)
  const previous = latest[0]
  if (previous === undefined) return { ok: true, ordinal: 1, colour: 'white' }
  const next = nextRevisionColour(previous.colour)
  if (isErr(next)) return { ok: false, after: next.error.after, detail: next.error.detail }
  return { ok: true, ordinal: previous.ordinal + 1, colour: next.value }
}

/**
 * Cut the next coloured draft.
 *
 * The colour comes from `@folio/script`'s `nextRevisionColour`, which
 * **refuses** past green: AGENTS.md names five colours and puts changing the
 * sequence behind an explicit decision, so a sixth invented here would be a
 * product decision taken in a commit. The refusal surfaces as a thrown error
 * with the pure core's own wording, because a production that has reached a
 * sixth revision needs a human, not a fallback - and `previewNextRevision`
 * lets a caller see it coming without tripping it.
 *
 * AGENTS.md, The AI agent: "One run produces one revision entry." This is that
 * entry, and it is why `versionId` is carried - the paper has to be
 * reproducible from the snapshot it was cut from.
 *
 * The episode's `revision_colour` moves to the new colour in the same
 * transaction. That column is "the colour of the current production draft"
 * (`schema/tenancy.ts`), the status bar reads it as `Rev. Blue`, and the
 * paginator gives unlocked pages that colour - so it and the newest revision
 * row cannot be allowed to disagree, and one transaction is how they are
 * kept from it. This is the design README's "snapshot a revision + colour
 * bump", as one write.
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
    readonly scenesTouched: number
    readonly pageCount: number
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
        scenesTouched: input.scenesTouched,
        pageCount: input.pageCount,
        locked: false,
        versionId: input.versionId,
        authorId: scope.actor,
      })
      .returning()
    const row = inserted[0]
    if (row === undefined) {
      throw new Error('Folio: inserting a revision returned no row. This is a bug in the repository.')
    }
    await tx
      .update(episodes)
      .set({ revisionColour: colour, updatedAt: new Date() })
      .where(scoped(scope, episodes, eq(episodes.id, episodeId)))
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
