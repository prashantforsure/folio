'use client'

import type { EpisodeSlug } from '@folio/contracts'
import { memo, useRef, useState } from 'react'

import type { GridLanes } from '../../../../../../lib/timeline/view'
import { GRID_LANES } from '../../../../../../lib/timeline/view'
import { FilterMenu, RecordToolbar } from '../_chrome/record-toolbar'
import { useDismiss } from '../_chrome/use-dismiss'

/**
 * The Timeline toolbar row, on the record routes' pieces
 * (`_chrome/record-toolbar.tsx`): the route name, the count chip (`17
 * placed`, or `4 flags` on Continuity), `flex: 1`, `Lanes by ▾` (threads,
 * the cast, the sets - the same grid, different rows), the episode scope
 * (`All episodes ▾`), the `⋯` menu (`Read in story order`, `Story
 * chronology as Markdown`) and the one solid primary, `Place 7 scenes`,
 * while anything is unplaced - which opens the proposal queue. The views
 * are the header's centre (`view-state.tsx`), as every route's are.
 *
 * ## The scope and the lanes are filters, not addresses
 *
 * `All episodes ▾` narrows the grid's columns to one episode - in story
 * order, one column; in chronology, the days that episode's scenes fall
 * on. `Lanes by ▾` swaps the rows. Both component state (the Storyboard's
 * ruling for its `All shots ▾`): ways of looking.
 *
 * ## `Place N scenes` opens the queue
 *
 * No `✦`: the proposals are the core's reading of the page, not a
 * model's, so the accent is not earned.
 */
export type ScopeOption = 'all' | EpisodeSlug

export const TimelineToolbar = memo(
  ({
    count,
    scope,
    episodes,
    onScope,
    lanes,
    onLanes,
    unplaced,
    queueOpen,
    onQueue,
    canRead,
    onRead,
    onExport,
  }: {
    /** `17 placed` / `4 flags`. */
    readonly count: string
    readonly scope: ScopeOption
    readonly episodes: readonly { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }[]
    readonly onScope: (scope: ScopeOption) => void
    readonly lanes: GridLanes
    readonly onLanes: (lanes: GridLanes) => void
    readonly unplaced: number
    readonly queueOpen: boolean
    readonly onQueue: () => void
    readonly canRead: boolean
    readonly onRead: () => void
    readonly onExport: () => void
  }) => {
    const [more, setMore] = useState(false)
    const moreRoot = useRef<HTMLDivElement>(null)
    useDismiss(more, () => setMore(false), moreRoot)
    const options: readonly ScopeOption[] = ['all', ...episodes.map((episode) => episode.slug)]
    const label = (option: ScopeOption): string => {
      if (option === 'all') return 'All episodes'
      const episode = episodes.find((entry) => entry.slug === option)
      return episode === undefined ? option : `E${String(episode.ordinal)} · ${episode.title}`
    }
    const laneLabel = (option: GridLanes): string => `Lanes by ${GRID_LANES.find((entry) => entry.id === option)?.label.toLowerCase() ?? option}`
    return (
      <RecordToolbar title="Timeline" total={count} countAttr="data-timeline-count" attr="data-timeline-toolbar">
        <FilterMenu value={lanes} options={GRID_LANES.map((entry) => entry.id)} label={laneLabel} attr="data-timeline-lanes" onPick={onLanes} />
        {episodes.length > 1 ? <FilterMenu value={scope} options={options} label={label} dividers={[1]} attr="data-timeline-scope" onPick={onScope} /> : null}
        <div ref={moreRoot} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={more}
            aria-label="More"
            title="Read in story order, export"
            data-timeline-more
            onClick={() => {
              setMore((value) => !value)
            }}
            className="folio-line-button grid h-[34px] w-[34px] place-items-center rounded-[10px] text-14 leading-none"
          >
            ⋯
          </button>
          {more ? (
            <div role="menu" className="folio-menu absolute right-0 top-[38px] w-[240px]">
              <button
                type="button"
                role="menuitem"
                data-timeline-read
                disabled={!canRead}
                title={canRead ? 'Every placed scene, in story order, on the page' : 'Place a scene first'}
                onClick={() => {
                  setMore(false)
                  onRead()
                }}
                className="folio-menu-item"
              >
                <span className="min-w-0 flex-1">Read in story order</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-timeline-export
                onClick={() => {
                  setMore(false)
                  onExport()
                }}
                className="folio-menu-item"
              >
                <span className="min-w-0 flex-1">Story chronology as Markdown</span>
              </button>
            </div>
          ) : null}
        </div>
        {unplaced > 0 ? (
          <button type="button" data-place-scenes aria-pressed={queueOpen} onClick={onQueue} className="folio-solid-button flex h-[34px] items-center whitespace-nowrap rounded-[10px] px-[14px] text-12-5 font-medium">
            {queueOpen ? 'Close the queue' : `Place ${String(unplaced)} ${unplaced === 1 ? 'scene' : 'scenes'}`}
          </button>
        ) : null}
      </RecordToolbar>
    )
  },
)
TimelineToolbar.displayName = 'TimelineToolbar'
