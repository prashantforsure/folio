'use client'

import type { ProjectId, StoryThreadId, StoryThreadRow, StoryTimeEdit, TimelineSceneRow } from '@folio/contracts'
import type { ContinuityFinding } from '@folio/script'
import { formatStoryDay, formatStoryTime, isStoryClock, precedesStoryTime } from '@folio/script'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { linkThread, saveStoryTime, unlinkThread } from '../../../../../../lib/timeline/actions'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { sceneRef, threadColourVar } from './figures'
import type { EpisodeLinks, Run } from './timeline-workspace'

/**
 * The right panel: the selected scene, 272px, `--panel`, 1px left border.
 *
 * `Route - Timeline.dc.html`, `showPanel`. Top to bottom: `E1 SC 14 · PAGE
 * 36` over the slug in Courier 13px and the gist; **Story time** - the day
 * and clock, the `⇅` chain button, and the relative line (`Next placed
 * day after E1 Sc 9`); **Threads** as chips with a dashed `＋`; **Present**
 * as chips; **Continuity** - the amber flag when the scene is a finding,
 * with `Review →`; and the foot's `Open in Script` / `Open in Scenes`.
 *
 * The bundle's story time is a display; here it is the form the brief's
 * "authored, not parsed" needs - a day, a clock, a flashback toggle, saved
 * whole on Save or Enter, cleared with `×`. The bundle's `Must already be
 * true` / `Becomes true after` facts are a third authored thing the brief
 * does not name and are not drawn.
 *
 * `⇅ Chain to previous scene` gives this scene the day of the scene before
 * it on the page - the last placed frame-story scene - and no clock. It is
 * the one-click "same day as the last one", which is what a straight read
 * mostly needs.
 */
export const ScenePanel = ({
  projectId,
  scene,
  previous,
  finding,
  previousOfFinding,
  threads,
  links,
  continuityHref,
  run,
}: {
  readonly projectId: ProjectId
  readonly scene: TimelineSceneRow
  /** The last placed frame-story scene before it on the page, if any. */
  readonly previous: TimelineSceneRow | null
  readonly finding: ContinuityFinding | null
  readonly previousOfFinding: TimelineSceneRow | null
  readonly threads: readonly StoryThreadRow[]
  /** Null only for a scene whose episode the context does not list - never in practice. */
  readonly links: EpisodeLinks | null
  readonly continuityHref: `${ProjectRoutePath}?view=continuity`
  readonly run: Run
}) => {
  const [day, setDay] = useState(scene.storyTime === null ? '' : String(scene.storyTime.day))
  const [clock, setClock] = useState(scene.storyTime?.clock ?? '')
  const [flashback, setFlashback] = useState(scene.flashback)
  const [picking, setPicking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // A new selection, or a save that came back, resets the form to the row.
  useEffect(() => {
    setDay(scene.storyTime === null ? '' : String(scene.storyTime.day))
    setClock(scene.storyTime?.clock ?? '')
    setFlashback(scene.flashback)
    setMessage(null)
    setPicking(false)
  }, [scene])

  const parsedDay = day.trim() === '' ? null : Number(day)
  const dayValid = parsedDay === null || Number.isInteger(parsedDay)
  const clockTrimmed = clock.trim()
  const clockValid = clockTrimmed === '' || isStoryClock(clockTrimmed)
  const dirty =
    (scene.storyTime === null ? '' : String(scene.storyTime.day)) !== day.trim() ||
    (scene.storyTime?.clock ?? '') !== clockTrimmed ||
    scene.flashback !== flashback

  const write = (edit: StoryTimeEdit): void => {
    setMessage(null)
    run(async () => {
      const result = await saveStoryTime(projectId, scene.sceneNodeId, edit)
      if (result.status !== 'saved') {
        setMessage(result.message)
        return result.message
      }
      return null
    })
  }

  const save = (): void => {
    if (!dayValid) {
      setMessage('A day is a whole number.')
      return
    }
    if (!clockValid) {
      setMessage('A clock is HH:MM, 24-hour.')
      return
    }
    if (parsedDay === null && clockTrimmed !== '') {
      setMessage('A clock needs a day.')
      return
    }
    write({ day: parsedDay, clock: clockTrimmed === '' ? null : clockTrimmed, flashback })
  }

  const chain = (): void => {
    if (previous?.storyTime === undefined || previous.storyTime === null) return
    write({ day: previous.storyTime.day, clock: null, flashback })
  }

  const clear = (): void => {
    write({ day: null, clock: null, flashback: false })
  }

  const link = (threadId: StoryThreadId): void => {
    setPicking(false)
    run(async () => {
      const result = await linkThread(projectId, scene.sceneNodeId, threadId)
      return result.status === 'saved' ? null : result.message
    })
  }

  const unlink = (threadId: StoryThreadId): void => {
    run(async () => {
      const result = await unlinkThread(projectId, scene.sceneNodeId, threadId)
      return result.status === 'saved' ? null : result.message
    })
  }

  const mine = scene.threads.flatMap((id) => {
    const thread = threads.find((entry) => entry.id === id)
    return thread === undefined ? [] : [thread]
  })
  const linkable = threads.filter((thread) => !scene.threads.includes(thread.id))

  const relative = ((): string => {
    if (scene.storyTime === null) return 'No story time yet. Give it a day to place it.'
    if (scene.flashback) return 'Flashback. Sits outside the day count.'
    if (previous === null || previous.storyTime === null) return 'First placed scene.'
    const mineTime = scene.storyTime
    const theirs = previous.storyTime
    const ref = sceneRef(previous)
    if (precedesStoryTime(mineTime, theirs)) return `Earlier than ${ref} (${formatStoryTime(theirs)})`
    if (mineTime.day === theirs.day) {
      const clocks = theirs.clock !== null && mineTime.clock !== null ? `, ${theirs.clock} → ${mineTime.clock}` : ''
      return `Same day as ${ref}${clocks}`
    }
    return `After ${ref} (${formatStoryTime(theirs)})`
  })()

  return (
    <aside
      data-scene-panel={scene.sceneNodeId}
      className="flex w-[272px] flex-none flex-col overflow-auto border-l border-line bg-panel"
    >
      <div className="flex flex-col gap-[6px] border-b border-line2 px-[14px] pb-[12px] pt-[14px]">
        <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">
          {sceneRef(scene)} · page {scene.page === null ? '—' : scene.page}
        </span>
        <span className="font-mono text-13 leading-[1.3]">{scene.heading}</span>
        <span className={`text-11-5 leading-[1.5] ${scene.synopsis === null ? 'text-ink3' : 'text-ink2'}`}>
          {scene.synopsis ?? 'No synopsis yet.'}
        </span>
      </div>

      <div className="flex flex-col gap-[14px] border-b border-line2 px-[14px] py-[12px]">
        <form
          data-story-time-form
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
          className="flex flex-col gap-[6px]"
        >
          <span className="text-10 text-ink3">Story time</span>
          <div className="flex gap-[6px]">
            <div className="flex flex-1 items-center gap-[6px] rounded-chrome border border-line bg-sheet px-[9px] py-[4px]">
              <span className="text-12 font-medium text-ink3">Day</span>
              <input
                type="number"
                step={1}
                value={day}
                onChange={(event) => {
                  setDay(event.target.value)
                }}
                aria-label="Story day"
                placeholder="–"
                className="w-[52px] min-w-0 border-none bg-transparent text-12 font-medium text-ink outline-none placeholder:text-ink3"
              />
              <span className="flex-1" />
              <input
                type="text"
                value={clock}
                onChange={(event) => {
                  setClock(event.target.value)
                }}
                aria-label="Story clock"
                placeholder="HH:MM"
                maxLength={5}
                className="w-[48px] min-w-0 border-none bg-transparent text-right font-mono text-11 text-ink2 outline-none placeholder:text-ink3"
              />
            </div>
            <button
              type="button"
              title="Chain to previous scene"
              aria-label="Chain to previous scene"
              disabled={previous === null || previous.storyTime === null}
              onClick={chain}
              data-chain-previous
              className="grid w-[30px] flex-none place-items-center rounded-chrome border border-line2 bg-transparent text-12 text-ink3 hover:bg-hover disabled:opacity-40"
              style={{ fontFamily: 'var(--font-glyph)' }}
            >
              ⇅
            </button>
          </div>
          <div className="flex items-center gap-[6px]">
            <button
              type="button"
              role="switch"
              aria-checked={flashback}
              aria-label="Flashback"
              onClick={() => {
                setFlashback((value) => !value)
              }}
              data-flashback-toggle
              className={`rounded-chrome border px-[8px] py-[2px] text-10-5 ${
                flashback ? 'border-note bg-note-bg text-note' : 'border-line2 bg-transparent text-ink2 hover:bg-hover'
              }`}
            >
              Flashback
            </button>
            <span className="flex-1" />
            {scene.storyTime !== null || scene.flashback ? (
              <button
                type="button"
                onClick={clear}
                title="Clear the story time"
                data-clear-story-time
                className="border-none bg-transparent p-0 text-10-5 text-ink3 hover:text-ink"
              >
                Clear
              </button>
            ) : null}
            <button
              type="submit"
              disabled={!dirty}
              data-save-story-time
              className="rounded-chrome border-none bg-ink px-[9px] py-[3px] text-10-5 font-semibold text-desk disabled:opacity-40"
            >
              Save
            </button>
          </div>
          <span className={`text-10-5 leading-[1.5] ${message === null ? 'text-ink3' : 'text-del'}`} data-story-time-note>
            {message ?? relative}
          </span>
        </form>

        <div className="flex flex-col gap-[6px]">
          <span className="text-10 text-ink3">Threads</span>
          <div className="flex flex-wrap gap-[5px]">
            {mine.map((thread) => (
              <span
                key={thread.id}
                data-scene-thread={thread.id}
                className="inline-flex items-center gap-[6px] rounded-chrome bg-sel px-[8px] py-[2px] text-10-5"
              >
                <span aria-hidden="true" className="h-[6px] w-[6px] rounded-[2px]" style={{ background: threadColourVar(thread.colour) }} />
                {thread.name}
                <button
                  type="button"
                  aria-label={`Remove from ${thread.name}`}
                  title="Remove from this thread"
                  onClick={() => {
                    unlink(thread.id)
                  }}
                  className="border-none bg-transparent p-0 text-10 text-ink3 hover:text-ink"
                >
                  ×
                </button>
              </span>
            ))}
            {picking ? (
              <select
                autoFocus
                aria-label="Add to thread"
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value
                  if (value !== '') link(value as StoryThreadId)
                }}
                onBlur={() => {
                  setPicking(false)
                }}
                className="rounded-chrome border border-line bg-sheet px-[6px] py-[2px] text-10-5 text-ink"
              >
                <option value="">Pick a thread…</option>
                {linkable.map((thread) => (
                  <option key={thread.id} value={thread.id}>
                    {thread.name}
                  </option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                aria-label="Add to a thread"
                title={
                  linkable.length === 0
                    ? threads.length === 0
                      ? 'No thread yet - make one in the column'
                      : 'On every thread already'
                    : 'Add to a thread'
                }
                disabled={linkable.length === 0}
                onClick={() => {
                  setPicking(true)
                }}
                data-add-to-thread
                className="rounded-chrome border border-dashed border-line bg-transparent px-[8px] py-[2px] text-10-5 text-ink3 hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                ＋
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-[6px]">
          <span className="text-10 text-ink3">Present</span>
          <div className="flex flex-wrap gap-[5px]">
            {scene.cast.length === 0 ? (
              <span className="text-10-5 text-ink3">No one speaks or is mentioned.</span>
            ) : (
              scene.cast.map((person) => (
                <span key={person.id} className="rounded-chrome bg-sel px-[8px] py-[2px] text-10-5">
                  {person.name}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="px-[14px] pb-[10px] pt-[12px] text-9-5 font-semibold uppercase tracking-label text-ink3">
        Continuity
      </div>
      <div className="flex flex-col gap-[10px] px-[14px] pb-[14px]">
        {finding === null ? (
          <span className="text-11 leading-[1.5] text-ink3">
            {scene.storyTime === null
              ? 'Unplaced scenes are not compared.'
              : 'Agrees with the scene before it on the page.'}
          </span>
        ) : (
          <div
            data-scene-flag={finding.kind}
            className="flex gap-[8px] rounded-chrome border border-note bg-note-bg px-[10px] py-[8px]"
          >
            <span aria-hidden="true" className="flex-none text-11 text-note" style={{ fontFamily: 'var(--font-glyph)' }}>
              ⚠
            </span>
            <span className="flex-1 text-11 leading-[1.5]">
              {finding.kind === 'flashback'
                ? `Flashback: earlier than ${previousOfFinding === null ? 'the scene before it' : sceneRef(previousOfFinding)} (${formatStoryTime(finding.previousTime)}). Legitimate, as flagged.`
                : `Happens before ${previousOfFinding === null ? 'the scene before it' : sceneRef(previousOfFinding)} (${formatStoryTime(finding.previousTime)}) though it's on the page after it.`}{' '}
              {finding.kind === 'order' ? (
                <Link href={continuityHref} className="whitespace-nowrap">
                  Review →
                </Link>
              ) : null}
            </span>
          </div>
        )}
        {scene.storyTime !== null && previous !== null && previous.storyTime !== null && !scene.flashback ? (
          <span className="text-10 text-ink3">
            Compared with {sceneRef(previous)} · {formatStoryDay(previous.storyTime.day)}
          </span>
        ) : null}
      </div>

      <div className="flex-1" />
      {links === null ? null : (
      <div className="flex gap-[6px] border-t border-line2 px-[14px] py-[10px]">
        <Link
          href={links.script}
          className="flex-1 rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-center text-11 text-ink2 no-underline hover:bg-hover hover:text-ink hover:no-underline"
        >
          Open in Script
        </Link>
        <Link
          href={links.scenes}
          className="flex-1 rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-center text-11 text-ink2 no-underline hover:bg-hover hover:text-ink hover:no-underline"
        >
          Open in Scenes
        </Link>
      </div>
      )}
    </aside>
  )
}
