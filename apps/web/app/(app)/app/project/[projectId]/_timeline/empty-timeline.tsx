'use client'

import { EmptyCard } from '../_chrome/empty-card'
import { useTimelineState } from './view-state'

/**
 * The empty state: no scene has a story time and no thread exists, on the
 * README's 440px card (`_chrome/empty-card.tsx`): `Your scenes have a
 * page order, not a story time`, the sentence about what placing does,
 * `Place 24 scenes` beside `＋ By hand`, and the caveat `Placing a scene
 * never changes its page order.`
 *
 * Two ways out, both real:
 *
 *   `Place N scenes`   opens the proposal queue over the grid: a story time
 *                      per scene read from the page's own cues, each with
 *                      its reason, accepted one at a time or whole and
 *                      undoable. Not the accent button: no model is asked,
 *                      so `✦` is not earned.
 *   `＋ By hand`        opens the grid with nothing placed, so the writer
 *                      can pick a scene and give it a day.
 *
 * With no scene at all there is nothing to place; only `By hand` is
 * offered and the caveat says so. The first pass's line "Sluglines marked
 * CONTINUOUS and LATER are respected" is gone; what the queue does read
 * off a heading it says on each row.
 */
export const EmptyTimeline = ({ scenes, onPlace }: { readonly scenes: number; readonly onPlace: () => void }) => {
  const { setByHand } = useTimelineState()
  return (
    <EmptyCard
      attr="data-empty-timeline"
      title="Your scenes have a page order, not a story time"
      body="Give each scene a place in time and the timeline shows flashbacks, gaps, and where threads run in parallel. Start from what the page says and correct the exceptions."
      {...(scenes > 0
        ? {
            primary: {
              label: `Place ${String(scenes)} ${scenes === 1 ? 'scene' : 'scenes'}`,
              attr: 'data-place-all' as const,
              onClick: () => {
                setByHand(true)
                onPlace()
              },
            },
          }
        : {})}
      secondary={{
        label: '＋ By hand',
        attr: 'data-place-by-hand',
        onClick: () => {
          setByHand(true)
        },
      }}
      caveat={scenes > 0 ? 'Placing a scene never changes its page order.' : 'Nothing to place yet. Scenes appear here as you write headings.'}
    />
  )
}
