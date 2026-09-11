'use server'

import type { Revision, RevisionId } from '@folio/contracts'
import { RevisionIdSchema } from '@folio/contracts'
import {
  cutRevision,
  listRevisions,
  lockRevision,
  readDocumentByKind,
  readMentionLabels,
  readRevision,
  readScreenplayNodes,
  readVersionSnapshot,
  reconcileNodes,
  retireNodes,
  reviveNodeIds,
  snapshotVersion,
} from '@folio/db'
import type { NodeId, ScreenplayNode } from '@folio/script'
import { diffScreenplays } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openEpisode } from '../script/gate'
import type { EpisodeGate } from '../script/gate'
import { measureAndDerive } from '../script/server'
import type { CompareResult, DraftRef, IssueResult, LockResult, RestoreResult } from './result'
import {
  compareDrafts as compare,
  locksInForce,
  paginateDraft,
  readSnapshotNodes,
} from './server'

/**
 * The Revisions route's writes, and its one read-shaped action.
 *
 * Every write goes gate -> repository -> pipeline -> result, as the Script
 * route's do (`lib/script/actions.ts`), and through the same gate: identity,
 * membership, scope, project, episode. Membership, not role - unchanged from
 * every earlier phase and flagged again.
 *
 * ## The rules this file implements
 *
 * **A revision is not a version.** `issueRevision` takes a version snapshot
 * *and* cuts a revision row, and the two are different writes with different
 * lifetimes: the snapshot is the immutable node list the paper is
 * reproducible from; the revision is the production artefact - colour in
 * sequence, author, note, tags, counts, locked flag - that points at it.
 *
 * **Locked pages must not renumber.** `lockRevisionPages` writes one
 * `locked_pages` row per page of the revision's snapshot, anchored to the
 * node each page opened on, and nothing more: it does not renumber, does not
 * resolve collisions, and does not decide what happens past the last lock.
 * `numberPages` in `@folio/script` reads the rows and reports.
 *
 * **Restore creates a new version. It never destroys history.**
 * `restoreRevision` is three writes in order: a `before_restore` version of
 * the document as it stands, so nothing the writer had is lost; the restored
 * node list, through `reconcileNodes`, so surviving rows and their anchors
 * are kept; a `restore` version of the result, so the restore is an entry in
 * the chain rather than a rewind of it. No revision row is touched, no
 * version row is deleted, and the tombstones of nodes the restore brings
 * back are lifted (`reviveNodeIds`) rather than fresh ids minted - ADR 0001
 * Q4: the tombstone exists so that undo can bring the node back as itself.
 */

const DraftRefSchema = z.union([
  z.literal('current').transform((): DraftRef => ({ kind: 'current' })),
  RevisionIdSchema.transform((id): DraftRef => ({ kind: 'revision', id })),
])

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

/** The gate plus the document and its node list - every action here needs all of it. */
const openScript = async (
  projectId: string,
  episode: string,
): Promise<
  | { readonly status: 'refused'; readonly message: string }
  | (EpisodeGate & {
      readonly document: NonNullable<Awaited<ReturnType<typeof readDocumentByKind>>>
      readonly nodes: readonly ScreenplayNode[]
    })
> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const document = await readDocumentByKind(gate.scope, gate.episode.id, 'screenplay')
  if (document === null) return { status: 'refused', message: 'This episode has no script yet.' }
  const read = await readScreenplayNodes(gate.scope, document.id)
  if (!read.ok) {
    return {
      status: 'refused',
      message: `The script would not read (${read.error.at || 'node'}: ${read.error.reason.kind}).`,
    }
  }
  return { ...gate, document, nodes: read.value.map((entry) => entry.node) }
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export const compareDrafts = async (
  projectId: string,
  episode: string,
  rawBase: string,
  rawHead: string,
): Promise<CompareResult> => {
  const base = DraftRefSchema.safeParse(rawBase)
  const head = DraftRefSchema.safeParse(rawHead)
  if (!base.success || !head.success) return { status: 'error', message: 'Pick two drafts to compare.' }

  const opened = await openScript(projectId, episode)
  if ('status' in opened) return opened
  const { scope, project, episode: row, document, nodes } = opened
  const [revisions, labels] = await Promise.all([
    listRevisions(scope, row.id),
    readMentionLabels(scope),
  ])
  return compare(scope, project, row, document, nodes, revisions, labels, base.data, head.data)
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

const LABEL_MAX = 120
const NOTE_MAX = 4_000

const IssueInputSchema = z.object({
  projectId: z.string(),
  episode: z.string(),
  label: z.string().trim().min(1).max(LABEL_MAX),
  note: z.string().trim().max(NOTE_MAX),
  tags: z.array(z.string().trim().min(1).max(40)).max(24),
  lock: z.boolean(),
})

export type IssueInput = z.input<typeof IssueInputSchema>

/**
 * Cut the next coloured draft from the working document.
 *
 * The counts on the row come from one `diffScreenplays` pass against the
 * previous revision's snapshot - or against nothing, for a first draft, in
 * which case every line is added. The page count comes from `paginate` over
 * the same list under the locks in force. `lock` locks the new revision's
 * pages in the same request, which is what "Pages locked for the table read"
 * on the bundle's Draft 4 describes.
 */
export const issueRevision = async (raw: IssueInput): Promise<IssueResult> => {
  const parsed = IssueInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      status: 'error',
      message:
        issue?.path[0] === 'label'
          ? `A draft needs a label of up to ${String(LABEL_MAX)} characters.`
          : issue?.path[0] === 'note'
            ? `A note is up to ${String(NOTE_MAX)} characters.`
            : 'The revision form did not read.',
    }
  }
  const input = parsed.data

  const opened = await openScript(input.projectId, input.episode)
  if ('status' in opened) return opened
  const { scope, project, episode, document, nodes } = opened

  const [revisions, labels] = await Promise.all([
    listRevisions(scope, episode.id),
    readMentionLabels(scope),
  ])
  const previous = revisions[revisions.length - 1]

  let before: readonly ScreenplayNode[] = []
  if (previous?.versionId !== null && previous?.versionId !== undefined) {
    const payload = await readVersionSnapshot(scope, previous.versionId)
    const read = payload === null ? null : readSnapshotNodes(payload)
    if (read !== null && read.ok) before = read.nodes
  }

  const diff = diffScreenplays(before, nodes, { format: project.format, mentionLabels: labels })
  if (!diff.ok) {
    return {
      status: 'error',
      message: `The sheet for format “${project.format}” is unresolved (${diff.error.kind}); a revision cannot be counted until it is ruled.`,
    }
  }
  const locks = await locksInForce(scope, revisions, null)
  const record = paginateDraft(nodes, project, labels, locks, episode.revisionColour)
  if (!record.ok) {
    return { status: 'error', message: `The draft could not be paginated (${record.error.kind}).` }
  }

  const version = await snapshotVersion(scope, document.id, 'manual', nodes, nodes.length)
  let revision: Revision
  try {
    revision = await cutRevision(scope, episode.id, {
      label: input.label,
      note: input.note === '' ? null : input.note,
      tags: input.tags,
      linesAdded: diff.value.linesAdded,
      linesDeleted: diff.value.linesDeleted,
      scenesTouched: diff.value.scenesTouched,
      pageCount: record.value.totals.pages,
      versionId: version.id,
    })
  } catch (error) {
    // The one refusal the repository throws: the sequence past green.
    return { status: 'refused', message: error instanceof Error ? error.message : 'The revision was refused.' }
  }

  if (input.lock) {
    await lockRevision(
      scope,
      revision.id,
      record.value.pages.map((page) => ({
        label: page.label,
        anchor: page.firstNode,
        colour: revision.colour,
      })),
    )
    revision = { ...revision, locked: true }
  }

  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'issued', revision }
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

export const lockRevisionPages = async (
  projectId: string,
  episode: string,
  rawRevisionId: string,
): Promise<LockResult> => {
  const id = RevisionIdSchema.safeParse(rawRevisionId)
  if (!id.success) return { status: 'error', message: 'That revision could not be found.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope, project, episode: row } = gate

  const revision = await readRevision(scope, id.data)
  if (revision === null || revision.episodeId !== row.id) {
    return { status: 'error', message: 'That revision could not be found.' }
  }
  if (revision.locked) return { status: 'locked', revision, pages: 0 }
  if (revision.versionId === null) {
    return { status: 'refused', message: `${revision.label} was cut without a snapshot, so its pages cannot be anchored.` }
  }
  const raw = await readVersionSnapshot(scope, revision.versionId)
  const read = raw === null ? null : readSnapshotNodes(raw)
  if (read === null || !read.ok) {
    return { status: 'refused', message: `${revision.label}’s snapshot would not read.` }
  }

  const [revisions, labels] = await Promise.all([
    listRevisions(scope, row.id),
    readMentionLabels(scope),
  ])
  // Under the locks in force before this one, so an earlier lock's A-pages
  // are locked under the labels they already print.
  const locks = await locksInForce(scope, revisions, revision.ordinal - 1)
  const record = paginateDraft(read.nodes, project, labels, locks, revision.colour)
  if (!record.ok) {
    return { status: 'error', message: `${revision.label} could not be paginated (${record.error.kind}).` }
  }
  const pages = record.value.pages.map((page) => ({
    label: page.label,
    anchor: page.firstNode,
    colour: revision.colour,
  }))
  await lockRevision(scope, revision.id, pages)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'locked', revision: { ...revision, locked: true }, pages: pages.length }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export const restoreRevision = async (
  projectId: string,
  episode: string,
  rawRevisionId: string,
): Promise<RestoreResult> => {
  const id = RevisionIdSchema.safeParse(rawRevisionId)
  if (!id.success) return { status: 'error', message: 'That revision could not be found.' }

  const opened = await openScript(projectId, episode)
  if ('status' in opened) return opened
  const { scope, project, episode: row, document, nodes } = opened

  const revision = await readRevision(scope, id.data as RevisionId)
  if (revision === null || revision.episodeId !== row.id) {
    return { status: 'error', message: 'That revision could not be found.' }
  }
  if (revision.versionId === null) {
    return { status: 'refused', message: `${revision.label} was cut without a snapshot, so there is nothing to restore.` }
  }
  const raw = await readVersionSnapshot(scope, revision.versionId)
  const read = raw === null ? null : readSnapshotNodes(raw)
  if (read === null || !read.ok) {
    return { status: 'refused', message: `${revision.label}’s snapshot would not read.` }
  }
  const restored = read.nodes

  // 1. The document as it stands, kept.
  await snapshotVersion(scope, document.id, 'before_restore', nodes, nodes.length)

  // 2. The restored list, written with the fewest rows touched. Ids the
  //    restore brings back are un-tombstoned first; ids it drops are retired.
  const live = new Set(nodes.map((node) => node.id as string))
  const returning = restored.map((node) => node.id).filter((nodeId) => !live.has(nodeId))
  await reviveNodeIds(scope, returning)
  const written = await reconcileNodes(scope, document.id, 'screenplay', restored)
  if ('unusable' in written) {
    return {
      status: 'error',
      message: `${String(written.unusable.length)} node id${written.unusable.length === 1 ? '' : 's'} in ${revision.label} are in use elsewhere in the project, so it cannot be restored as written.`,
    }
  }
  const kept = new Set(restored.map((node) => node.id as string))
  await retireNodes(
    scope,
    document.id,
    nodes.filter((node) => !kept.has(node.id)).map((node) => ({ nodeId: node.id as NodeId, mergedInto: null })),
  )

  // 3. The restore itself, as a version in the chain.
  const version = await snapshotVersion(scope, document.id, 'restore', restored, restored.length)

  await measureAndDerive(scope, project, row, document, restored)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'restored', revision, versionOrdinal: version.ordinal, nodes: restored.length }
}
