'use client'

import type { StoryThreadId, StoryThreadRow, TimelineEpisodeColumn, TimelineSceneRow } from '@folio/contracts'
import type { Chronology, StoryJump } from '@folio/script'
import { formatStoryDay, formatStoryTime } from '@folio/script'
import type { NodeId } from '@folio/script'

import { countOrAbsent } from '../../../../../../lib/workspace/format'
import { NO_TIME, plural, sceneRef, shortSlug, threadColourVar } from './figures'
import { useTimelineState } from './timeline-state'

/**
 * The grid: threads down, episodes or story days across.
 *
 * `Route - Timeline.dc.html`, `isGrid`. A sticky column header - the axis
 * label (`EPISODES →` / `STORY TIME →`), then one column per episode as
 * written (`E1 Standpipe · 104 pp · 7 placed`) or per story day (`Day 2 ·
 * 5 scenes`, a flashback-only day on `--note-bg`). One row per thread with
 * its colour square, name and span, sticky on the left; a last row, `No
 * thread`, for scenes on none. Each cell holds the cards of the scenes
 * whose **first** thread is the row and whose episode or day is the
 * column, in page order in story view and in story-time order in
 * chronology.
 *
 * A card is the bundle's: the 3px thread bar on its left, `E1 Sc 14` and
 * the short slug, then the chip - story view says when the scene happens
 * (`Day 2 · 06:40`, or `no time` dashed for an unplaced scene, which story
 * view still shows so it can be picked and placed), chronology says where
 * it sits on the page (`E1 · p.36`). A jump arrow after the chip in story
 * view: `↶` earlier than the scene before it, `↷` skips ahead. A dot per
 * further thread on the right. The selected card sits on `--accent-bg`
 * with an `--accent-line` border; a hidden thread's row dims to .35.
 *
 * Unplaced scenes are not in any chronology column; the strip under the
 * rows says how many and offers `Continue from Day N`.
 */

export type GridView = 'story' | 'chrono'

const NO_THREAD = 'none'

type Column = {
  readonly key: string
  readonly name: string
  readonly sub: string
  readonly meta: string
  readonly flashback: boolean
  /** Scene ids in this column, in the column's order. */
  readonly sceneIds: readonly NodeId[]
}

type Row = {
  readonly key: string
  readonly name: string
  readonly span: string
  readonly colour: string | null
  readonly hidden: boolean
}

export const StoryGrid = ({
  view,
  scenes,
  threads,
  episodes,
  chronology,
  jumps,
  onContinue,
}: {
  readonly view: GridView
  readonly scenes: readonly TimelineSceneRow[]
  readonly threads: readonly StoryThreadRow[]
  readonly episodes: readonly TimelineEpisodeColumn[]
  readonly chronology: Chronology
  readonly jumps: Readonly<Record<string, StoryJump>>
  /** Place every unplaced scene on this day. */
  readonly onContinue: (day: number) => void
}) => {
  const { hidden, selected, select } = useTimelineState()
  const byId = new Map<NodeId, TimelineSceneRow>(scenes.map((scene) => [scene.sceneNodeId, scene]))
  const threadById = new Map<StoryThreadId, StoryThreadRow>(threads.map((thread) => [thread.id, thread]))

  const columns: readonly Column[] =
    view === 'story'
      ? episodes.map((episode) => ({
          key: episode.episode,
          name: `E${String(episode.ordinal)}`,
          sub: episode.title,
          meta: `${countOrAbsent(episode.pages, ' pp')} · ${String(episode.placed)} placed`,
          flashback: false,
          sceneIds: scenes.filter((scene) => scene.episode === episode.episode).map((scene) => scene.sceneNodeId),
        }))
      : chronology.days.map((day) => ({
          key: String(day.day),
          name: formatStoryDay(day.day),
          sub: day.flashbacksOnly ? 'flashback' : '',
          meta: plural(day.sceneIds.length, 'scene'),
          flashback: day.flashbacksOnly,
          sceneIds: day.sceneIds,
        }))

  const rows: readonly Row[] = [
    ...threads.map((thread) => ({
      key: thread.id,
      name: thread.name,
      span:
        thread.span === null
          ? 'no scenes yet'
          : thread.span.from === thread.span.to
            ? `E${String(thread.span.from)}`
            : `E${String(thread.span.from)} → E${String(thread.span.to)}`,
      colour: threadColourVar(thread.colour),
      hidden: hidden.has(thread.id),
    })),
    ...(scenes.some((scene) => scene.threads.length === 0)
      ? [{ key: NO_THREAD, name: 'No thread', span: 'scenes on no storyline', colour: null, hidden: false }]
      : []),
  ]

  const rowOf = (scene: TimelineSceneRow): string => scene.threads[0] ?? NO_THREAD

  const unplaced = chronology.unplaced.flatMap((id) => {
    const scene = byId.get(id)
    return scene === undefined ? [] : [scene]
  })
  const lastDay = chronology.days[chronology.days.length - 1]?.day ?? null
  const firstUnplaced = unplaced[0]
  const lastUnplaced = unplaced[unplaced.length - 1]

  const template = `150px ${columns.map(() => 'minmax(200px,1fr)').join(' ')}`

  return (
    <div className="min-w-0 flex-1 overflow-auto" data-story-grid={view}>
      <div className="flex min-w-min flex-col">
        <div
          className="sticky top-0 z-[2] grid border-b border-line bg-panel"
          style={{ gridTemplateColumns: template }}
        >
          <div className="border-r border-line2 px-[14px] py-[10px] text-9-5 font-semibold uppercase tracking-label text-ink3">
            {view === 'story' ? 'Episodes' : 'Story time'} →
          </div>
          {columns.map((column) => (
            <div
              key={column.key}
              data-grid-column={column.key}
              className={`flex flex-col gap-[2px] border-r border-line2 px-[12px] py-[8px] ${column.flashback ? 'bg-note-bg' : 'bg-panel'}`}
            >
              <div className="flex items-baseline gap-[6px]">
                <span className={`text-12-5 font-medium ${column.flashback ? 'text-note' : 'text-ink'}`}>{column.name}</span>
                <span className="text-10 text-ink3">{column.sub}</span>
              </div>
              <span className="tabular text-10 text-ink3">{column.meta}</span>
            </div>
          ))}
        </div>

        {columns.length === 0 ? (
          <div className="px-[14px] py-[24px] text-11-5 text-ink3">
            {view === 'story'
              ? 'No episode has a scene yet.'
              : 'No scene has a story time yet. Pick one in story order and give it a day.'}
          </div>
        ) : null}

        {rows.map((row) => (
          <div
            key={row.key}
            data-grid-row={row.key}
            className="grid border-b border-line2"
            style={{ gridTemplateColumns: template, opacity: row.hidden ? 0.35 : 1 }}
          >
            <div className="sticky left-0 z-[1] flex flex-col gap-[4px] border-r border-line2 bg-panel px-[14px] py-[12px]">
              <div className="flex items-center gap-[7px]">
                <span
                  aria-hidden="true"
                  className="h-[8px] w-[8px] flex-none rounded-[2px]"
                  style={{ background: row.colour ?? 'var(--line)' }}
                />
                <span className="text-12 font-medium leading-[1.2]">{row.name}</span>
              </div>
              <span className="pl-[15px] text-10 text-ink3">{row.span}</span>
            </div>
            {columns.map((column) => {
              const cards = column.sceneIds.flatMap((id) => {
                const scene = byId.get(id)
                return scene === undefined || rowOf(scene) !== row.key ? [] : [scene]
              })
              return (
                <div
                  key={column.key}
                  className={`flex min-h-[64px] flex-col gap-[6px] border-r border-line2 px-[8px] py-[10px] ${column.flashback ? 'bg-note-bg' : ''}`}
                >
                  {cards.map((scene) => {
                    const isSelected = scene.sceneNodeId === selected
                    const jump = view === 'story' && !scene.flashback ? (jumps[scene.sceneNodeId] ?? null) : null
                    const chip =
                      view === 'story'
                        ? scene.storyTime === null
                          ? NO_TIME
                          : formatStoryTime(scene.storyTime)
                        : `E${String(scene.episodeOrdinal)} · ${scene.page === null ? `Sc ${String(scene.number)}` : `p.${String(scene.page)}`}`
                    const also = scene.threads.slice(1).flatMap((id) => {
                      const thread = threadById.get(id)
                      return thread === undefined ? [] : [thread]
                    })
                    return (
                      <button
                        key={scene.sceneNodeId}
                        type="button"
                        data-scene-card={scene.sceneNodeId}
                        aria-pressed={isSelected}
                        onClick={() => {
                          select(scene.sceneNodeId)
                        }}
                        className={`relative flex flex-col gap-[4px] rounded-chrome border pb-[7px] pl-[12px] pr-[9px] pt-[7px] text-left hover:border-accent-line ${
                          isSelected ? 'border-accent-line bg-accent-bg' : 'border-line2 bg-sheet'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute bottom-[6px] left-0 top-[6px] w-[3px] rounded-r-[2px]"
                          style={{ background: row.colour ?? 'var(--line)' }}
                        />
                        <span className="flex items-baseline gap-[6px]">
                          <span className="tabular whitespace-nowrap text-10 text-ink3">{sceneRef(scene)}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-10-5 text-ink">{shortSlug(scene.heading)}</span>
                        </span>
                        <span className="flex items-center gap-[5px]">
                          <span
                            data-scene-chip
                            className={`whitespace-nowrap rounded-chrome border px-[6px] py-[1px] text-9-5 ${
                              scene.flashback
                                ? 'border-note bg-note-bg text-note'
                                : scene.storyTime === null && view === 'story'
                                  ? 'border-dashed border-line text-ink3'
                                  : 'border-line2 text-ink2'
                            }`}
                            title={scene.flashback ? 'Flashback' : undefined}
                          >
                            {chip}
                          </span>
                          {jump === null ? null : (
                            <span
                              aria-hidden="true"
                              data-scene-jump={jump}
                              title={jump === 'back' ? 'Earlier than the scene before it' : 'Skips ahead'}
                              className="text-10 text-note"
                              style={{ fontFamily: 'var(--font-glyph)' }}
                            >
                              {jump === 'back' ? '↶' : '↷'}
                            </span>
                          )}
                          <span className="flex-1" />
                          {also.map((thread) => (
                            <span
                              key={thread.id}
                              title={thread.name}
                              className="h-[6px] w-[6px] rounded-full"
                              style={{ background: threadColourVar(thread.colour) }}
                            />
                          ))}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}

        {unplaced.length > 0 ? (
          <div
            data-unplaced-strip
            className="flex items-center gap-[12px] border-b border-line2 bg-note-bg px-[14px] py-[10px]"
          >
            <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-note" />
            <span className="text-11-5 text-ink">
              {plural(unplaced.length, 'scene has', 'scenes have')} no story time and{' '}
              {unplaced.length === 1 ? "isn't" : "aren't"} shown in Chronology
            </span>
            {firstUnplaced === undefined ? null : (
              <span className="text-10-5 text-ink3">
                {sceneRef(firstUnplaced)}
                {lastUnplaced !== undefined && lastUnplaced !== firstUnplaced ? ` – ${sceneRef(lastUnplaced)}` : ''}
              </span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              data-continue-from
              onClick={() => {
                onContinue(lastDay ?? 1)
              }}
              className="rounded-chrome border border-line bg-transparent px-[9px] py-[3px] text-10-5 text-ink2 hover:bg-hover"
            >
              {lastDay === null ? 'Assume continuous' : `Continue from ${formatStoryDay(lastDay)}`}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
