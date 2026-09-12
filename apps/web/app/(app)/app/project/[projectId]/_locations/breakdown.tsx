'use client'

import type { BreakdownRow, ProjectId } from '@folio/contracts'
import Link from 'next/link'

import { ABSENT, eighths } from '../../../../../../lib/workspace/format'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import { DayNightBar } from './day-night-bar'
import type { EpisodeHead } from './locations-workspace'

/**
 * The breakdown: every location against every episode.
 *
 * `Route - Locations.dc.html`, `isBreakdown`: the paragraph, then a table
 * on `--panel` - `Location · I/E · E1 … En · Total · Pages` - one row per
 * record in tree order, sub-sets indented and in `--ink2`. A cell is the
 * scene count with a 56×3px day-against-night bar under it, `·` in
 * `--ink3` for none. The row is the roll-up: a primary set's cell counts
 * its sub-sets' scenes too, which is what "how many days in the chawl"
 * reads off this table. Pages are eighths from the measurement record,
 * summed over the row's measured scenes, `—` where none is.
 *
 * The bundle draws four episode columns; a film has one and a series has
 * as many as it has, so the grid is built from the episode list.
 */
export const Breakdown = ({
  projectId,
  rows,
  episodes,
}: {
  readonly projectId: ProjectId
  readonly rows: readonly BreakdownRow[]
  readonly episodes: readonly EpisodeHead[]
}) => {
  const columns = `minmax(200px,1.6fr) 44px repeat(${String(Math.max(1, episodes.length))},minmax(70px,1fr)) 80px 90px`
  return (
    <div className="min-w-0 flex-1 overflow-auto px-[22px] pb-[60px] pt-[20px]" data-breakdown>
      <div className="flex max-w-[1040px] flex-col gap-[12px]">
        <p className="m-0 max-w-[70ch] text-11-5 leading-[1.5] text-ink3">
          Every location against every episode. Cell counts are scenes; the bar under each is day against night. Sort
          by weight to see where the series actually lives.
        </p>
        <div className="overflow-hidden rounded-chrome border border-line bg-panel">
          <div
            className="grid items-center gap-[10px] border-b border-line px-[14px] py-[9px] text-9-5 font-semibold uppercase tracking-[.08em] text-ink3"
            style={{ gridTemplateColumns: columns }}
          >
            <span>Location</span>
            <span>I/E</span>
            {episodes.map((episode) => (
              <span key={episode.slug} title={episode.title}>
                E{episode.ordinal}
              </span>
            ))}
            <span>Total</span>
            <span>Pages</span>
          </div>
          {rows.map((row) => {
            const sub = row.parentId !== null
            return (
              <Link
                key={row.id}
                href={locationHref(projectId, row.id)}
                data-breakdown-row={row.id}
                className="grid items-center gap-[10px] border-b border-line2 py-[9px] pr-[14px] text-ink no-underline hover:bg-hover hover:no-underline"
                style={{ gridTemplateColumns: columns, paddingLeft: sub ? 14 + 18 * Math.min(row.depth, 3) : 14 }}
              >
                <span className="flex min-w-0 items-center gap-[8px]">
                  <span
                    className={`min-w-0 flex-1 truncate ${sub ? 'text-11-5 text-ink2' : 'text-12-5 font-medium text-ink'}`}
                  >
                    {row.name}
                  </span>
                </span>
                <span className="text-9 font-semibold tracking-[.06em] text-ink3">{row.ie ?? ABSENT}</span>
                {row.cells.map((cell, index) => (
                  <span key={episodes[index]?.slug ?? index} className="flex flex-col gap-[3px]" data-breakdown-cell={cell.scenes}>
                    <span className={`tabular text-12 ${cell.scenes > 0 ? 'text-ink' : 'text-ink3'}`}>
                      {cell.scenes > 0 ? cell.scenes : '·'}
                    </span>
                    {cell.scenes > 0 ? (
                      <DayNightBar
                        scenes={cell.scenes}
                        dayScenes={cell.dayScenes}
                        nightScenes={cell.nightScenes}
                        height={3}
                        className="w-full max-w-[56px]"
                      />
                    ) : (
                      <span className="h-[3px]" />
                    )}
                  </span>
                ))}
                <span className="tabular text-12 font-medium" data-breakdown-total>
                  {row.rollup.scenes}
                </span>
                <span className="font-mono text-10-5 text-ink2">{eighths(row.eighths)}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
