'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'

import { placeScenes } from '../../../../../../lib/timeline/actions'
import { plural } from './figures'
import type { Run } from './timeline-workspace'
import { useTimelineState } from './timeline-state'

/**
 * The empty state: no scene has a story time and no thread exists.
 *
 * `Route - Timeline.dc.html`, `isEmpty`: a 460px card on `--panel` -
 * `TIMELINE · N SCENES`, "Your scenes have a page order, not a story
 * time", the sentence about what placing does, then the two buttons and
 * the note under them. Copy as specified.
 *
 * Two ways out, both real:
 *
 *   `✦ Assume continuous`   every scene goes on Day 1 in page order, one
 *                            statement, awaited. A declared assumption the
 *                            writer then corrects - not a date parsed from
 *                            a slugline, which the brief forbids.
 *   `Place by hand`          opens the grid with nothing placed, so the
 *                            writer can pick a scene and give it a day.
 *
 * With no scene at all there is nothing to place; both buttons are held
 * back and the note says so. Same card, both themes.
 */
export const EmptyTimeline = ({
  projectId,
  scenes,
  run,
}: {
  readonly projectId: ProjectId
  readonly scenes: number
  readonly run: Run
}) => {
  const router = useRouter()
  const { setByHand } = useTimelineState()

  const assume = (): void => {
    run(async () => {
      const result = await placeScenes(projectId, 1)
      if (result.status !== 'placed') return result.message
      router.refresh()
      return null
    })
  }

  return (
    <div className="flex flex-1 items-center justify-center px-[24px] py-[40px]" data-empty-timeline>
      <div className="flex w-full max-w-[460px] flex-col gap-[16px] rounded-chrome border border-line bg-panel px-[24px] pb-[24px] pt-[22px]">
        <div className="flex flex-col gap-[5px]">
          <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">
            Timeline · {plural(scenes, 'scene')}
          </span>
          <span className="font-serif text-[22px] font-medium leading-[1.15]">
            Your scenes have a page order, not a story time
          </span>
          <span className="text-12 leading-[1.55] text-ink2">
            Give each scene a place in time and the timeline shows flashbacks, gaps, and where threads run in
            parallel. Start from a straight read and correct the exceptions.
          </span>
        </div>
        {scenes > 0 ? (
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={assume}
              data-assume-continuous
              className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border-none bg-accent px-[12px] py-[8px] text-12 font-semibold text-accent-ink hover:opacity-90"
            >
              <span aria-hidden="true" className="text-10" style={{ fontFamily: 'var(--font-glyph)' }}>
                ✦
              </span>
              Assume continuous
            </button>
            <button
              type="button"
              onClick={() => {
                setByHand(true)
              }}
              data-place-by-hand
              className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-line bg-transparent px-[12px] py-[8px] text-12 text-ink2 hover:bg-hover hover:text-ink"
            >
              Place by hand
            </button>
          </div>
        ) : null}
        <span className="text-10-5 text-ink3">
          {scenes > 0
            ? 'Continuous puts every scene on Day 1 in page order, one after another. Sluglines marked CONTINUOUS and LATER are respected.'
            : 'Nothing to place yet. Scenes appear here as you write headings.'}
        </span>
      </div>
    </div>
  )
}
