import type { DocumentRecord, Episode, Project, Thread, Version } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import {
  listOpenThreads,
  listSceneLinks,
  listVersions,
  readDocumentByKind,
  readEntityCounts,
  readEpisodeNavMeta,
  readMentionLabels,
  readOutlineNodes,
} from '@folio/db'
import type { MentionLabel, OutlineNode } from '@folio/script'
import { labelBook, outlineBeats, outlineWordCount } from '@folio/script'

/**
 * The server half of the Outline route: what a render reads.
 *
 * The outline is its own document (`documents.kind = 'outline'`) with the
 * seven-block set, in the same `nodes` table as the script and never in the
 * same list. It is not paginated - the bundle's Info panel says `Prose · not
 * paginated` - so there is no measurement here and nothing runs after a
 * save: `deferAfterSave` belongs to the script, whose saves change page
 * counts and entities. An outline save changes the outline.
 *
 * ## Statistics
 *
 * The panel's line is the bundle's: "Counts come from the script and beats,
 * not from this page." Scenes come from `readEpisodeNavMeta` (derived rows in
 * state `present`), characters / locations / relations from the derived
 * caches through `readEntityCounts`, beats and words from the outline's own
 * blocks, and shots are `0` because shots are not a table. Nothing here is
 * estimated and nothing here calls `derive`.
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
      /** How many of the outline's beats name at least one scene - the panel's `Beats linked`. */
      readonly beatsLinked: number
    }
  | { readonly state: 'unreadable'; readonly document: DocumentRecord; readonly detail: string }

/** How many beat blocks have a scene naming them, from `scenes.beats`. */
const countLinkedBeats = (nodes: readonly OutlineNode[], linked: ReadonlySet<string>): number =>
  outlineBeats(nodes).filter((beat) => linked.has(beat.id as string)).length

export const loadOutline = async (
  scope: ProjectScope,
  project: Project,
  episode: Episode,
): Promise<OutlineLoad> => {
  const document = await readDocumentByKind(scope, episode.id, 'outline')
  if (document === null) return { state: 'empty' }

  const [read, labels, threads, versions, meta, counts, linked] = await Promise.all([
    readOutlineNodes(scope, document.id),
    readMentionLabels(scope),
    listOpenThreads(scope),
    listVersions(scope, document.id, 20),
    readEpisodeNavMeta(scope, episode.id, project.format),
    readEntityCounts(scope),
    listSceneLinks(scope, episode.id, project.format),
  ])
  if (!read.ok) {
    return { state: 'unreadable', document, detail: `${read.error.at || 'block'}: ${read.error.reason.kind}` }
  }
  const nodes = read.value.map((entry) => entry.node)
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
    beatsLinked: countLinkedBeats(nodes, new Set(linked.flatMap((scene) => scene.beats.map(String)))),
  }
}
