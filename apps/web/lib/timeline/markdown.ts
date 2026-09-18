import type { StoryThreadRow, TimelineSceneRow } from '@folio/contracts'
import type { Chronology } from '@folio/script'
import { formatStoryDay } from '@folio/script'

import { plural, sceneRef, shortSlug } from './view'

/**
 * The story chronology as Markdown - the toolbar's `⋯ → Story chronology
 * as Markdown` (the rebuild, phase 4), on `lib/outline/markdown.ts`'s
 * precedent: a pure function of the rows, the download itself the
 * workspace's. What a writers' room or a script supervisor asks for: the
 * scenes in story order, a heading per day, each scene's ref, heading,
 * clock and threads, then the unplaced scenes at the foot so the list is
 * honest about what it does not know.
 */
export const chronologyMarkdown = (
  projectTitle: string,
  scenes: readonly TimelineSceneRow[],
  threads: readonly StoryThreadRow[],
  chronology: Chronology,
): string => {
  const byId = new Map(scenes.map((scene) => [scene.sceneNodeId, scene]))
  const threadName = new Map(threads.map((thread) => [thread.id, thread.name]))
  const line = (scene: TimelineSceneRow): string => {
    const clock = scene.storyTime?.clock === null || scene.storyTime === null ? '' : ` · ${scene.storyTime.clock}`
    const names = scene.threads.flatMap((id) => threadName.get(id) ?? [])
    const on = names.length === 0 ? '' : ` — ${names.join(', ')}`
    const flag = scene.flashback ? ' _(flashback)_' : ''
    return `- **${sceneRef(scene)}** ${shortSlug(scene.heading)}${clock}${on}${flag}`
  }
  const blocks = chronology.days.map((day) => {
    const rows = day.sceneIds.flatMap((id) => byId.get(id) ?? [])
    const head = day.flashbacksOnly ? `## ${formatStoryDay(day.day)} · flashback` : `## ${formatStoryDay(day.day)}`
    return [head, '', ...rows.map(line)].join('\n')
  })
  const unplaced = chronology.unplaced.flatMap((id) => byId.get(id) ?? [])
  const foot = unplaced.length === 0 ? [] : ['', `## Not placed in time (${String(unplaced.length)})`, '', ...unplaced.map(line)]
  const placed = scenes.length - unplaced.length
  return [`# ${projectTitle} — story chronology`, '', `${plural(placed, 'scene')} placed across ${plural(chronology.days.length, 'story day')}.`, '', ...blocks.join('\n\n').split('\n'), ...foot].join('\n').trim().concat('\n')
}

/** `monsoon-line-chronology.md`: the title as a slug, ASCII only, never empty. */
export const chronologyFilename = (title: string): string => {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return `${slug === '' ? 'story' : slug}-chronology.md`
}
