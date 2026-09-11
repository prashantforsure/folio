import type { DocumentRecord, Episode, Project, Revision } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import {
  listLockedPages,
  listMemberProfiles,
  listRevisions,
  previewNextRevision,
  readDocumentByKind,
  readMentionLabels,
  readScreenplayNodes,
  readVersionSnapshot,
} from '@folio/db'
import type {
  DiffEntry,
  LockedPage,
  MeasurementRecord,
  MentionLabel,
  RevisionColour,
  ScreenplayNode,
} from '@folio/script'
import { diffScreenplays, paginate, readScreenplayNode } from '@folio/script'
import { cache } from 'react'

import { loadEpisode } from '../workspace/context'
import type { EpisodeContext } from '../workspace/context'
import type { CompareResult, DiffPage, DraftHeader, DraftRef } from './result'
import { draftKey } from './result'

/**
 * The server half of the Revisions route: what a render reads, and the one
 * comparison both the page and the `compareDrafts` action run.
 *
 * ## What is read, and from where
 *
 *   drafts          `revisions` rows for the episode, oldest first, plus one
 *                   `current` header for the working document. A version is
 *                   not a draft - see `result.ts`.
 *   a snapshot      `versions.snapshot` through the revision's `version_id`,
 *                   read back through `@folio/script`'s own strict reader, so
 *                   a snapshot that would not read as a node list is reported
 *                   and never diffed.
 *   the comparison  `diffScreenplays` over the two lists at the project's
 *                   format, then `paginate` over the head list to decide which
 *                   page each entry is on - so the page labels in the diff are
 *                   the same labels the Script route prints, locks included.
 *   authors         `users.display_name` through the membership join.
 *
 * Nothing here estimates. A count the compare bar prints is a count the diff
 * returned; a page label is one the paginator returned.
 *
 * ## Which locks apply to which draft
 *
 * A revision's pages are numbered under the locks that were in force when
 * it was cut: the latest *locked* revision at or before it. The working
 * document is numbered under the latest locked revision overall - the same
 * choice `lib/script/server.ts` makes for the sheet. So comparing Draft 3 to
 * Draft 5 paginates Draft 5 under Draft 4's locks, and its inserted pages
 * print as A-pages, which is the point.
 */

/** A snapshot is the node list as `saveScript` stored it: a bare array. */
export const readSnapshotNodes = (
  raw: unknown,
): { readonly ok: true; readonly nodes: readonly ScreenplayNode[] } | { readonly ok: false; readonly detail: string } => {
  if (!Array.isArray(raw)) return { ok: false, detail: 'the snapshot is not a node list' }
  const nodes: ScreenplayNode[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const read = readScreenplayNode(raw[index])
    if (!read.ok) {
      return { ok: false, detail: `nodes[${String(index)}]${read.error.at === '' ? '' : `.${read.error.at}`}: ${read.error.reason.kind}` }
    }
    nodes.push(read.value)
  }
  return { ok: true, nodes }
}

export const revisionHeader = (revision: Revision): DraftHeader => ({
  ref: { kind: 'revision', id: revision.id },
  key: revision.id,
  name: revision.label,
  colour: revision.colour,
  at: revision.createdAt,
  locked: revision.locked,
  ordinal: revision.ordinal,
})

export const currentHeader = (document: DocumentRecord, episode: Episode): DraftHeader => ({
  ref: { kind: 'current' },
  key: 'current',
  name: 'Current',
  colour: episode.revisionColour,
  at: document.updatedAt,
  locked: false,
  ordinal: null,
})

/**
 * The locks in force for a draft: the latest locked revision at or before
 * `uptoOrdinal`, or overall when `null` (the working document).
 */
export const locksInForce = async (
  scope: ProjectScope,
  revisions: readonly Revision[],
  uptoOrdinal: number | null,
): Promise<readonly LockedPage[]> => {
  const eligible = revisions.filter(
    (revision) => revision.locked && (uptoOrdinal === null || revision.ordinal <= uptoOrdinal),
  )
  const latest = eligible[eligible.length - 1]
  if (latest === undefined) return []
  const pages = await listLockedPages(scope, latest.id)
  return pages.map((page) => ({ label: page.label, anchor: page.anchor, revision: page.colour }))
}

/** Paginate one draft the way the sheet would, for its page labels. */
export const paginateDraft = (
  nodes: readonly ScreenplayNode[],
  project: Project,
  labels: readonly MentionLabel[],
  lockedPages: readonly LockedPage[],
  revision: RevisionColour,
): ReturnType<typeof paginate> =>
  paginate(nodes, {
    format: project.format,
    pageMode: 'paged',
    liveRepaginate: project.liveRepaginate,
    lockedPages,
    mentionLabels: labels,
    revision,
  })

/**
 * Group diff entries by the head page they landed on.
 *
 * A head entry is on the page of its first run. A deleted entry is not on
 * the head's paper at all, so it is shown on the page of the entry before
 * it - where the reader would look for it. A node split across a page break
 * is shown whole on the page it starts on: this is a review surface, and the
 * split is the sheet's business.
 */
export const pagesOf = (
  entries: readonly DiffEntry[],
  record: MeasurementRecord,
): readonly DiffPage[] => {
  const pageOfNode = new Map<string, number>()
  for (const node of record.nodes) {
    const first = node.runs[0]
    if (first !== undefined) pageOfNode.set(String(node.id), first.page)
  }
  const buckets = new Map<number, DiffEntry[]>()
  let last = 1
  for (const entry of entries) {
    const at = entry.kind === 'deleted' ? last : (pageOfNode.get(String(entry.id)) ?? last)
    last = at
    const bucket = buckets.get(at) ?? []
    bucket.push(entry)
    buckets.set(at, bucket)
  }
  return record.pages.map((page) => {
    const onPage = buckets.get(page.ordinal) ?? []
    return {
      ordinal: page.ordinal,
      label: page.label,
      locked: page.locked,
      revision: page.revision,
      entries: onPage,
      changed: onPage.reduce(
        (total, entry) => total + entry.lines.filter((line) => line.kind !== 'same').length,
        0,
      ),
    }
  })
}

/** The node list behind a draft, or why there is none. */
const nodesFor = async (
  scope: ProjectScope,
  ref: DraftRef,
  current: readonly ScreenplayNode[],
  revisions: readonly Revision[],
): Promise<
  | { readonly ok: true; readonly nodes: readonly ScreenplayNode[]; readonly revision: Revision | null }
  | { readonly ok: false; readonly message: string }
> => {
  if (ref.kind === 'current') return { ok: true, nodes: current, revision: null }
  const revision = revisions.find((entry) => entry.id === ref.id)
  if (revision === undefined) return { ok: false, message: 'That draft is not one of this episode’s revisions.' }
  if (revision.versionId === null) {
    return { ok: false, message: `${revision.label} was cut without a snapshot, so it cannot be compared.` }
  }
  const raw = await readVersionSnapshot(scope, revision.versionId)
  if (raw === null) return { ok: false, message: `${revision.label}’s snapshot is missing.` }
  const read = readSnapshotNodes(raw)
  if (!read.ok) return { ok: false, message: `${revision.label}’s snapshot would not read (${read.detail}).` }
  return { ok: true, nodes: read.nodes, revision }
}

/**
 * Compare two drafts. The one function both the page's default comparison
 * and the `compareDrafts` action call, so the two cannot disagree.
 */
export const compareDrafts = async (
  scope: ProjectScope,
  project: Project,
  episode: Episode,
  document: DocumentRecord,
  current: readonly ScreenplayNode[],
  revisions: readonly Revision[],
  labels: readonly MentionLabel[],
  base: DraftRef,
  head: DraftRef,
): Promise<CompareResult> => {
  const [baseNodes, headNodes] = await Promise.all([
    nodesFor(scope, base, current, revisions),
    nodesFor(scope, head, current, revisions),
  ])
  if (!baseNodes.ok) return { status: 'unavailable', message: baseNodes.message }
  if (!headNodes.ok) return { status: 'unavailable', message: headNodes.message }

  const diff = diffScreenplays(baseNodes.nodes, headNodes.nodes, {
    format: project.format,
    mentionLabels: labels,
  })
  if (!diff.ok) {
    return {
      status: 'error',
      message: `The sheet for format “${project.format}” is unresolved (${diff.error.kind}), so the drafts cannot be laid out to compare.`,
    }
  }

  const headRevision = headNodes.revision
  const locks = await locksInForce(scope, revisions, headRevision === null ? null : headRevision.ordinal)
  const record = paginateDraft(
    headNodes.nodes,
    project,
    labels,
    locks,
    headRevision === null ? episode.revisionColour : headRevision.colour,
  )
  if (!record.ok) {
    return { status: 'error', message: `The head draft could not be paginated (${record.error.kind}).` }
  }

  return {
    status: 'compared',
    comparison: {
      base: baseNodes.revision === null ? currentHeader(document, episode) : revisionHeader(baseNodes.revision),
      head: headRevision === null ? currentHeader(document, episode) : revisionHeader(headRevision),
      pages: pagesOf(diff.value.entries, record.value),
      totals: diff.value.totals,
      scenesTouched: diff.value.scenesTouched,
      lockIssues: record.value.lockIssues,
    },
  }
}

// ---------------------------------------------------------------------------
// What the route reads
// ---------------------------------------------------------------------------

export type RevisionsLoad =
  | { readonly state: 'empty' }
  | { readonly state: 'unreadable'; readonly document: DocumentRecord; readonly detail: string }
  | {
      readonly state: 'script'
      readonly document: DocumentRecord
      readonly nodeCount: number
      readonly revisions: readonly Revision[]
      /** Oldest first, the working document last - the order the compare bar lists. */
      readonly drafts: readonly DraftHeader[]
      /** `users.display_name` by user id, for `by Priya`. */
      readonly authors: Readonly<Record<string, string>>
      readonly next: Awaited<ReturnType<typeof previewNextRevision>>
      /** Latest revision -> current, or null when nothing has been issued yet. */
      readonly comparison: CompareResult | null
    }

export const loadRevisions = cache(
  async (context: EpisodeContext): Promise<RevisionsLoad> => {
    const { scope, project, episode } = context
    const document = await readDocumentByKind(scope, episode.id, 'screenplay')
    if (document === null) return { state: 'empty' }

    const read = await readScreenplayNodes(scope, document.id)
    if (!read.ok) {
      return {
        state: 'unreadable',
        document,
        detail: `${read.error.at || 'node'}: ${read.error.reason.kind}`,
      }
    }
    const nodes = read.value.map((entry) => entry.node)

    const [revisions, labels, profiles, next] = await Promise.all([
      listRevisions(scope, episode.id),
      readMentionLabels(scope),
      listMemberProfiles(scope),
      previewNextRevision(scope, episode.id),
    ])
    const latest = revisions[revisions.length - 1]
    const comparison =
      latest === undefined
        ? null
        : await compareDrafts(
            scope,
            project,
            episode,
            document,
            nodes,
            revisions,
            labels,
            { kind: 'revision', id: latest.id },
            { kind: 'current' },
          )

    return {
      state: 'script',
      document,
      nodeCount: nodes.length,
      revisions,
      drafts: [...revisions.map(revisionHeader), currentHeader(document, episode)],
      authors: Object.fromEntries(profiles.map((profile) => [profile.userId, profile.displayName])),
      next,
      comparison,
    }
  },
)

/** The route's context and its load, for a page or a header that has only raw params. */
export const enterRevisions = async (
  rawProjectId: string,
  segment: string | null,
): Promise<{ readonly context: EpisodeContext; readonly load: RevisionsLoad }> => {
  const context = await loadEpisode(rawProjectId, segment)
  return { context, load: await loadRevisions(context) }
}

export { draftKey }
