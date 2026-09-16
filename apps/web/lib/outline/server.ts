import type { DocumentRecord, Episode, Project, Thread, Version } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import {
  listOpenThreads,
  listVersions,
  readDocumentByKind,
  readEntityCounts,
  readEpisodeNavMeta,
  readMentionLabels,
  readOutlineNodes,
} from '@folio/db'
import type { MentionLabel, ModelDefect, OutlineHeading, OutlineNode } from '@folio/script'
import { labelBook, outlineBeats, outlineHeadings, outlineWordCount } from '@folio/script'
import { cache } from 'react'

/**
 * The server half of the Outline route: what a render reads.
 *
 * The outline is its own document (`documents.kind = 'outline'`) with the
 * seven-block set, in the same `nodes` table as the script and never in the
 * same list. It is not paginated, so there is no measurement here and
 * nothing runs after a save: `deferAfterSave` belongs to the script, whose
 * saves change page counts and entities. An outline save changes the
 * outline.
 *
 * ## One read, two readers
 *
 * Since the v2 pass the sidebar lists the outline's headings ("In this
 * outline", `docs/ui design/Route - Outline v2.dc.html`) and the sidebar is
 * the writing layout's, rendered beside the page in the same request. Both
 * need the document and its blocks, so that read is `cache()`d per request
 * (`readOutlineDocument`) - the page's `loadOutline` and the sidebar's
 * `loadOutlineToc` call it and the second call costs nothing. React's
 * `cache` keys on argument identity; `scope` and `episode` come from the
 * `cache()`d `loadEpisode`, so the same objects reach both callers.
 *
 * ## Statistics
 *
 * Scenes come from `readEpisodeNavMeta` (derived rows in state `present`),
 * characters / locations / relations from the derived caches through
 * `readEntityCounts`, beats and words from the outline's own blocks (a beat
 * is one of its blocks; there is no Beats route), and shots are `0` because
 * shots are not a table. Nothing here is estimated and nothing here calls
 * `derive`.
 */

export type OutlineStats = {
  readonly scenes: number
  readonly words: number
  readonly characters: number
  readonly locations: number
  readonly beats: number
  /** Shots are not a table. */
  readonly shots: 0
  readonly relations: number
}

export type OutlineDocumentRead =
  | { readonly state: 'empty' }
  | { readonly state: 'draft'; readonly document: DocumentRecord; readonly nodes: readonly OutlineNode[] }
  | { readonly state: 'unreadable'; readonly document: DocumentRecord; readonly defect: ModelDefect }

/** The label book, once per request: the page and the sidebar both resolve mentions through it. */
const readLabels = cache(async (scope: ProjectScope): Promise<readonly MentionLabel[]> => readMentionLabels(scope))

/** The document row and its blocks, once per request. */
export const readOutlineDocument = cache(async (scope: ProjectScope, episode: Episode): Promise<OutlineDocumentRead> => {
  const document = await readDocumentByKind(scope, episode.id, 'outline')
  if (document === null) return { state: 'empty' }
  const read = await readOutlineNodes(scope, document.id)
  if (!read.ok) return { state: 'unreadable', document, defect: read.error }
  return { state: 'draft', document, nodes: read.value.map((entry) => entry.node) }
})

export type OutlineLoad =
  | { readonly state: 'empty' }
  | {
      readonly state: 'draft'
      readonly document: DocumentRecord
      readonly nodes: readonly OutlineNode[]
      readonly labels: readonly MentionLabel[]
      readonly stats: OutlineStats
      readonly threads: readonly Thread[]
      readonly versions: readonly Version[]
    }
  | { readonly state: 'unreadable'; readonly document: DocumentRecord; readonly detail: string }

export const loadOutline = async (
  scope: ProjectScope,
  project: Project,
  episode: Episode,
): Promise<OutlineLoad> => {
  const read = await readOutlineDocument(scope, episode)
  if (read.state === 'empty') return { state: 'empty' }
  if (read.state === 'unreadable') {
    return { state: 'unreadable', document: read.document, detail: `${read.defect.at || 'block'}: ${read.defect.reason.kind}` }
  }
  const { document, nodes } = read

  const [labels, threads, versions, meta, counts] = await Promise.all([
    readLabels(scope),
    listOpenThreads(scope),
    listVersions(scope, document.id, 20),
    readEpisodeNavMeta(scope, episode.id, project.format),
    readEntityCounts(scope),
  ])
  const ids = new Set(nodes.map((node) => node.id as string))
  const book = labelBook(labels)
  return {
    state: 'draft',
    document,
    nodes,
    labels,
    stats: {
      scenes: meta.scenes,
      words: outlineWordCount(nodes, book),
      characters: counts.characters,
      locations: counts.locations,
      beats: outlineBeats(nodes).length,
      shots: 0,
      relations: counts.relations,
    },
    threads: threads.filter(
      (thread) =>
        (thread.anchor.kind === 'outline_block' || thread.anchor.kind === 'beat') && ids.has(thread.anchor.nodeId),
    ),
    versions,
  }
}

/**
 * The sidebar's list, server-rendered so the first paint has it: the
 * headings in document order, labels resolved through the same label book
 * the page uses. `null` when there is no outline yet - the group draws its
 * "nothing to list" copy. The workspace takes over the list once it mounts
 * (`lib/outline/toc.ts`).
 */
export const loadOutlineToc = async (scope: ProjectScope, episode: Episode): Promise<readonly OutlineHeading[] | null> => {
  const read = await readOutlineDocument(scope, episode)
  if (read.state !== 'draft') return null
  const labels = await readLabels(scope)
  return outlineHeadings(read.nodes, labelBook(labels))
}
