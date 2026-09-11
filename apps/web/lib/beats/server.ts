import type { BeatRow, BeatScene, DocumentRecord, Episode, Project } from '@folio/contracts'
import { UNSET_BEAT_TIMING } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { listSceneLinks, readBeatRows, readDocumentByKind, readMentionLabels, readOutlineNodes } from '@folio/db'
import type { NodeId } from '@folio/script'
import { labelBook, outlineBeats, outlineNodeText } from '@folio/script'

/**
 * The server half of the Beats route: what a render reads, and where each
 * part comes from.
 *
 * A beat is an outline `beat` block (`@folio/script`, `beats.ts`), so the
 * route reads the episode's outline first and there is no beat without one.
 * Then, for the blocks it found:
 *
 *   `ordinal`, `text`   the block - its place among the beat blocks and its
 *                       rendered text; the name and one-line are split at
 *                       render by `readBeatHeadline`
 *   `timing`            the `beats` row, LEFT JOINed in spirit: a beat that
 *                       was never timed has no row and reads as unset
 *   `scenes`            `scenes.beats` inverted - every present scene of the
 *                       episode whose array names the block, in script
 *                       order, with the page from the paged measurement
 *
 * `scenes` on the load is every present scene of the episode, for the
 * picker; a beat's own list is a subset of it.
 */

export type BeatsLoad =
  | { readonly state: 'no-outline'; readonly scenes: readonly BeatScene[] }
  | {
      readonly state: 'beats'
      readonly document: DocumentRecord
      readonly beats: readonly BeatRow[]
      readonly scenes: readonly BeatScene[]
    }
  | { readonly state: 'unreadable'; readonly document: DocumentRecord; readonly detail: string }

export const loadBeats = async (scope: ProjectScope, project: Project, episode: Episode): Promise<BeatsLoad> => {
  const [document, links] = await Promise.all([
    readDocumentByKind(scope, episode.id, 'outline'),
    listSceneLinks(scope, episode.id, project.format),
  ])
  const scenes: readonly BeatScene[] = links.map((scene) => ({
    sceneNodeId: scene.sceneNodeId,
    number: scene.number,
    heading: scene.heading,
    page: scene.page,
  }))
  if (document === null) return { state: 'no-outline', scenes }

  const [read, labels] = await Promise.all([readOutlineNodes(scope, document.id), readMentionLabels(scope)])
  if (!read.ok) {
    return { state: 'unreadable', document, detail: `${read.error.at || 'block'}: ${read.error.reason.kind}` }
  }
  const nodes = read.value.map((entry) => entry.node)
  const found = outlineBeats(nodes)
  const rows = await readBeatRows(
    scope,
    found.map((beat) => beat.id),
  )
  const book = labelBook(labels)

  const scenesOf = new Map<string, BeatScene[]>()
  for (const scene of links) {
    for (const beatId of scene.beats) {
      const list = scenesOf.get(beatId as string) ?? []
      list.push({ sceneNodeId: scene.sceneNodeId, number: scene.number, heading: scene.heading, page: scene.page })
      scenesOf.set(beatId as string, list)
    }
  }

  const beats: readonly BeatRow[] = found.map((beat) => {
    const row = rows.get(beat.id)
    return {
      beatNodeId: beat.id,
      ordinal: beat.ordinal,
      text: outlineNodeText(beat.node, book),
      timing:
        row === undefined
          ? UNSET_BEAT_TIMING
          : { durationMinutes: row.durationMinutes, placedAtMinute: row.placedAtMinute, canvas: row.canvas },
      scenes: scenesOf.get(beat.id as string) ?? [],
    }
  })
  return { state: 'beats', document, beats, scenes }
}

/** The beat block ids of an outline, for an action checking an id belongs to this episode. */
export const beatIdsOf = (nodes: readonly { readonly type: string; readonly id: NodeId }[]): ReadonlySet<string> =>
  new Set(nodes.filter((node) => node.type === 'beat').map((node) => node.id as string))
