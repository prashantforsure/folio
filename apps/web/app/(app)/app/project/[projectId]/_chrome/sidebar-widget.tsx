'use client'

import type { BoardCoverageRow } from '@folio/contracts'
import { useSelectedLayoutSegment } from 'next/navigation'

import { coverageOf, waitingCaption } from '../../../../../../lib/storyboard/board'
import { useBoardCoverage } from '../../../../../../lib/storyboard/coverage'

/**
 * The summary widget pinned to the sidebar's foot - `docs/ui design/README.md`,
 * "Sidebar": "one summary widget pinned to the bottom (coverage, budget -
 * whatever that route counts)". The Script, Outline and Scenes mockups
 * count credits; the Storyboard mockup counts boards (`Boards drawn 1 / 3`,
 * a bar, `2 shots waiting on a frame`). One card shape, two readings; the
 * segment picks, as `sidebar-group.tsx` does for the list above it.
 *
 * Every value is read: the balance from the ledger, the coverage from
 * `readBoardCoverage` on the first paint and from the cell the workspace
 * publishes after every write (`lib/storyboard/coverage.ts`).
 */
export const SidebarWidget = ({
  credits,
  initialCoverage,
}: {
  readonly credits: {
    readonly available: number
    /** `available / settled`, clamped - the bar's fill. */
    readonly share: number
    /** What a credit buys today, at `FRAME_GENERATION_COST`. */
    readonly frames: number
  }
  readonly initialCoverage: readonly BoardCoverageRow[]
}) => {
  const segment = useSelectedLayoutSegment()
  const live = useBoardCoverage()

  if (segment === 'storyboard') {
    const coverage = coverageOf(live?.rows ?? initialCoverage)
    const share = coverage.scenes === 0 ? 0 : coverage.boarded / coverage.scenes
    return (
      <div data-boards-card className="flex flex-col gap-[7px] rounded-card border border-line2 bg-s1 px-[12px] py-[11px]">
        <div className="flex items-baseline justify-between">
          <span className="text-12 text-ink2">Boards drawn</span>
          <span className="tabular text-13 font-medium" data-boards-drawn>
            {coverage.boarded} / {coverage.scenes}
          </span>
        </div>
        <div className="h-[4px] overflow-hidden rounded-[3px] bg-s3">
          <div className="h-full rounded-[3px] bg-accent" style={{ width: `${String(Math.round(share * 100))}%` }} />
        </div>
        <span className="text-11 text-ink3" data-boards-waiting>
          {waitingCaption(coverage)}
        </span>
      </div>
    )
  }

  return (
    <div data-credits-card className="flex flex-col gap-[7px] rounded-card border border-line2 bg-s1 px-[12px] py-[11px]">
      <div className="flex items-baseline justify-between">
        <span className="text-12 text-ink2">Credits</span>
        <span className="tabular text-13 font-medium">{credits.available.toLocaleString('en-US')}</span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-[3px] bg-s3">
        <div className="h-full rounded-[3px] bg-accent" style={{ width: `${String(Math.round(credits.share * 100))}%` }} />
      </div>
      <span className="text-11 text-ink3">
        ≈ {credits.frames.toLocaleString('en-US')} {credits.frames === 1 ? 'frame' : 'frames'} · no expiry
      </span>
    </div>
  )
}
