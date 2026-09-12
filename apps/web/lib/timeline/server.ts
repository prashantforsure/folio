import type {
  StoryThreadRow,
  TimelineEpisodeColumn,
  TimelineSceneRow,
} from '@folio/contracts'
import { storyThreadId as brandStoryThreadId } from '@folio/contracts'
import { listStoryThreads, listTimelineScenes, readEpisodeBoard, readMentionLabels } from '@folio/db'
import type { ContinuityFinding, StoryJump, StorySpan } from '@folio/script'
import { chronology, continuityFindings, storyJumps, storySpan } from '@folio/script'
import type { Chronology, NodeId } from '@folio/script'
import { cache } from 'react'

import type { ProjectContext } from '../workspace/context'
import { loadProject } from '../workspace/context'

/**
 * Everything the Timeline route reads, and where each part comes from.
 *
 * A *join* over the tables that own each fact, then the pure core's
 * reads over the result - never a computation over the script:
 *
 *   `scenes[]`        `scene_derivations` ⋈ `nodes` ⋈ `documents` ⋈ `episodes`
 *                     ⋈ `scenes` (authored) ⋈ `measurement_scenes`
 *                                                     (`listTimelineScenes`)
 *   `scenes[].cast`   `characters.name` through the record id
 *                                                     (`readMentionLabels`)
 *   `threads[]`       `story_threads`, with each one's scene count and the
 *                     episodes it spans counted off `scenes[].threads`
 *   `episodes[]`      the episode board - title, page count - plus how many
 *                     of each episode's scenes are placed
 *   `findings`, `jumps`, `chronology`, `span`
 *                     `@folio/script`'s `timeline.ts` over `scenes[]`, in
 *                     page order. Pure; tested there.
 *
 * A thread id on a scene that names no thread is dropped here, the
 * `key_lines` rule: the text column is not a foreign key, and a stale id is
 * data to ignore, not an error to show.
 *
 * `cache()`d per request, keyed by the project context, so the thread
 * column (in the layout), the header and the body share one read.
 */

export type TimelineLoad = {
  /** Page order across episodes. */
  readonly scenes: readonly TimelineSceneRow[]
  readonly threads: readonly StoryThreadRow[]
  readonly episodes: readonly TimelineEpisodeColumn[]
  readonly findings: readonly ContinuityFinding[]
  readonly jumps: ReadonlyMap<NodeId, StoryJump>
  readonly chronology: Chronology
  readonly span: StorySpan | null
  readonly placed: number
  readonly flashbacks: number
}

export const loadTimeline = cache(async (context: ProjectContext): Promise<TimelineLoad> => {
  const { scope, project, episodes } = context
  const [records, threadRows, labels, board] = await Promise.all([
    listTimelineScenes(scope, project.format),
    listStoryThreads(scope),
    readMentionLabels(scope),
    readEpisodeBoard(scope, project.format),
  ])

  const names = new Map<string, string>(
    labels.filter((label) => label.entity === 'character').map((label) => [label.id, label.label]),
  )
  const known = new Set<string>(threadRows.map((thread) => thread.id))

  const scenes: TimelineSceneRow[] = records.map((record) => ({
    sceneNodeId: record.sceneNodeId,
    episode: record.episode,
    episodeOrdinal: record.episodeOrdinal,
    number: record.number,
    heading: record.heading,
    synopsis: record.synopsis,
    page: record.page,
    cast: record.cast.map((id) => ({ id, name: names.get(id) ?? '(record missing)' })),
    storyTime: record.storyDay === null ? null : { day: record.storyDay, clock: record.storyClock },
    flashback: record.flashback,
    threads: record.threads.filter((id) => known.has(id)).map(brandStoryThreadId),
  }))

  const threads: StoryThreadRow[] = threadRows.map((thread) => {
    const mine = scenes.filter((scene) => scene.threads.includes(thread.id))
    const ordinals = mine.map((scene) => scene.episodeOrdinal)
    return {
      ...thread,
      scenes: mine.length,
      span: ordinals.length === 0 ? null : { from: Math.min(...ordinals), to: Math.max(...ordinals) },
    }
  })

  const columns: TimelineEpisodeColumn[] = board.map(({ episode, pages }) => {
    const inEpisode = scenes.filter((scene) => scene.episode === episode.slug)
    return {
      episode: episode.slug,
      ordinal: episode.ordinal,
      title: episode.title,
      pages,
      scenes: inEpisode.length,
      placed: inEpisode.filter((scene) => scene.storyTime !== null).length,
    }
  })
  // The board and the context list the same rows; the context's order is the
  // running order every other route uses, so it is the one kept.
  const byOrdinal = new Map(columns.map((column) => [column.ordinal, column]))
  const ordered = episodes.flatMap((episode) => {
    const column = byOrdinal.get(episode.ordinal)
    return column === undefined ? [] : [column]
  })

  const pure = scenes.map((scene) => ({
    id: scene.sceneNodeId,
    storyTime: scene.storyTime,
    flashback: scene.flashback,
  }))

  return {
    scenes,
    threads,
    episodes: ordered,
    findings: continuityFindings(pure),
    jumps: storyJumps(pure),
    chronology: chronology(pure),
    span: storySpan(pure),
    placed: scenes.filter((scene) => scene.storyTime !== null).length,
    flashbacks: scenes.filter((scene) => scene.flashback).length,
  }
})

/** The route's context and its load, for a page or a layout that has only raw params. */
export const enterTimeline = async (
  rawProjectId: string,
): Promise<{ readonly context: ProjectContext; readonly load: TimelineLoad }> => {
  const context = await loadProject(rawProjectId)
  return { context, load: await loadTimeline(context) }
}
