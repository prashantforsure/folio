import type { StoryThreadRow, TimelineEpisodeColumn, TimelineSceneRow } from '@folio/contracts'
import { storyThreadId as brandStoryThreadId } from '@folio/contracts'
import { listCharacterRecords, listFindingVerdicts, listStoryThreads, listTimelineScenes, readEpisodeBoard, readMentionLabels, readProjectScreenplayNodes } from '@folio/db'
import type { NodeId } from '@folio/script'
import { timeCuesOf } from '@folio/script'
import { cache } from 'react'

import type { ProjectContext } from '../workspace/context'
import { episodeFigures, threadFigures } from './view'

/**
 * Everything the Timeline route reads, and where each part comes from.
 *
 * A *join* over the tables that own each fact, then two readings over the
 * node list - never a computation the client could not repeat:
 *
 *   `scenes[]`         `scene_derivations` ⋈ `nodes` ⋈ `documents` ⋈ `episodes`
 *                      ⋈ `scenes` (authored) ⋈ `measurement_scenes`
 *                                                      (`listTimelineScenes`)
 *   `scenes[].cast`    `characters.name` through the record id
 *   `scenes[].set`     `locations.name` through `scene_derivations.location_id`
 *                                                      (both `readMentionLabels`)
 *   `scenes[].cues`,   `@folio/script`'s `timeCuesOf` over the project's node
 *   `scenes[].light`   list - what the heading and the first action lines say
 *                      about when. Read here, stored nowhere.
 *   `threads[]`        `story_threads`, with each one's scene count, its row
 *                      count and the episodes it spans (`lib/timeline/view.ts`)
 *   `episodes[]`       the episode board - title, page count - plus how many
 *                      of each episode's scenes are placed and the days they
 *                      cover (`view.ts` again)
 *   `introductions`    `character_derivations.introduced_at` - the heading
 *                      each character is introduced under, for the
 *                      `before-introduction` rule
 *   `deliberate`       `timeline_findings` - the keys the writer marked
 *
 * The order, the chronology, the continuity findings and the proposals are
 * **not** loaded: they are pure functions of these rows (`@folio/script`'s
 * `timeline.ts`, `continuity.ts`, `time-cues.ts`) and the client runs them
 * over what it has, so an optimistic edit re-orders the grid before the
 * refresh lands (the rebuild, phase 2). The first pass computed them here
 * and shipped a `Map` across the boundary as a record.
 *
 * A thread id on a scene that names no thread is dropped here, the
 * `key_lines` rule: the text column is not a foreign key, and a stale id is
 * data to ignore, not an error to show. A cast or set id whose record is
 * gone prints as absent rather than as a placeholder.
 *
 * `cache()`d per request, keyed by the project context, so the sidebar (in
 * the layout), the header and the body share one read.
 */

export type TimelineLoad = {
  /** Page order across episodes. */
  readonly scenes: readonly TimelineSceneRow[]
  readonly threads: readonly StoryThreadRow[]
  readonly episodes: readonly TimelineEpisodeColumn[]
  /** Character id → the heading node that introduces them. A record, so it crosses the boundary. */
  readonly introductions: Readonly<Record<string, NodeId>>
  /** The finding keys the writer marked deliberate. */
  readonly deliberate: readonly string[]
}

/** What the load needs of the context: the scope, the project (its format) and the episodes in running order. The assistant's turn builds this from its gate. */
export type TimelineContext = Pick<ProjectContext, 'scope' | 'project' | 'episodes'>

export const loadTimeline = cache(async (context: TimelineContext): Promise<TimelineLoad> => {
  const { scope, project, episodes } = context
  const [records, threadRows, labels, board, nodesRead, characters, deliberate] = await Promise.all([
    listTimelineScenes(scope, project.format),
    listStoryThreads(scope),
    readMentionLabels(scope),
    readEpisodeBoard(scope, project.format),
    readProjectScreenplayNodes(scope),
    listCharacterRecords(scope),
    listFindingVerdicts(scope),
  ])

  const names = new Map<string, string>(labels.filter((label) => label.entity === 'character').map((label) => [label.id, label.label]))
  const sets = new Map<string, string>(labels.filter((label) => label.entity === 'location').map((label) => [label.id, label.label]))
  const known = new Set<string>(threadRows.map((thread) => thread.id))
  const labelBook = new Map(labels.map((label) => [`${label.entity}:${label.id}`, label.label]))
  const cues = nodesRead.ok
    ? timeCuesOf(nodesRead.value, new Set(records.map((record) => record.sceneNodeId)), (target) => labelBook.get(`${target.entity}:${target.id}`))
    : new Map()

  const scenes: TimelineSceneRow[] = records.map((record) => {
    const setName = record.locationId === null ? undefined : sets.get(record.locationId)
    const cue = cues.get(record.sceneNodeId)
    return {
      sceneNodeId: record.sceneNodeId,
      episode: record.episode,
      episodeOrdinal: record.episodeOrdinal,
      number: record.number,
      heading: record.heading,
      synopsis: record.synopsis,
      page: record.page,
      eighths: record.eighths,
      cast: record.cast.flatMap((id) => {
        const name = names.get(id)
        return name === undefined ? [] : [{ id, name }]
      }),
      set: record.locationId === null || setName === undefined ? null : { id: record.locationId, name: setName },
      storyTime: record.storyDay === null ? null : { day: record.storyDay, clock: record.storyClock },
      flashback: record.flashback,
      threads: record.threads.filter((id) => known.has(id)).map(brandStoryThreadId),
      light: cue?.light ?? 'unspecified',
      cues: cue === undefined ? null : { timeOfDay: cue.timeOfDay, bind: cue.bind, action: cue.action },
    }
  })

  const threads = threadFigures(threadRows, scenes)

  // The board and the context list the same rows; the context's order is the
  // running order every other route uses, so it is the one kept.
  const byOrdinal = new Map(board.map(({ episode, pages }) => [episode.ordinal, { slug: episode.slug, ordinal: episode.ordinal, title: episode.title, pages }]))
  const columns = episodes.flatMap((episode) => {
    const entry = byOrdinal.get(episode.ordinal)
    return entry === undefined ? [] : [episodeFigures(entry, scenes)]
  })

  const introductions: Record<string, NodeId> = {}
  for (const character of characters) {
    const scene = character.derived?.introducedAt?.scene ?? null
    if (scene !== null) introductions[character.id] = scene
  }

  return { scenes, threads, episodes: columns, introductions, deliberate: [...deliberate] }
})
