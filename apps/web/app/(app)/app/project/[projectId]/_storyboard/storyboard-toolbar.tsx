'use client'

import { Icon } from '@folio/ui'
import { memo, useRef, useState } from 'react'

import { SHOT_FILTERS, SHOT_FILTER_LABEL, SHOT_SORTS, SHOT_SORT_LABEL } from '../../../../../../lib/storyboard/board'
import type { ShotFilter, ShotSort } from '../../../../../../lib/storyboard/board'
import { useDismiss } from '../_chrome/use-dismiss'
import type { StoryboardView } from './view-state'

/**
 * The Storyboard's toolbar row - `docs/ui design/Route - Storyboard
 * v2.dc.html`: `flex: 1`, then one `Display` button. Padding `12px 20px`,
 * 10px gaps. The mockup's view-switcher pill (three icon tabs: scene
 * boards, shot canvas, shot list) opened the row; since 2026-09-17 it is
 * the header's centre, with names (`lib/workspace/views.ts`,
 * `_chrome/header-views.tsx`), as every route's views are.
 *
 * ## One menu (2026-09-17)
 *
 * The mockup drew `All shots ▾` beside the display options; the canvas
 * pass folds the filter into the one `Display` menu, three sections:
 *
 *   Show      two toggles, descriptions and frames, for a denser board.
 *   Sort      the list view's order - story order, shot size, lens, needs
 *             work first (`sortShots`). Drawn only on the list: the board
 *             and the canvas are the sequence, and a sorted canvas would
 *             lie about the thread.
 *   Filter    over the same rows in every view: all, with a frame, waiting
 *             on a frame, proposed.
 *
 * All component state - and so is the view, since 2026-09-17: `board |
 * canvas | list` is the cell in `view-state.tsx`, the header's tabs are
 * three buttons over it, and the URL stays `/storyboard` (it was `?view=`
 * until the client ruled it as Characters' tabs were).
 *
 * The mockup's `Group: Scene ▾` is still not drawn. Shots group by scene
 * and by nothing else - a shot hangs off a heading - and a menu with one
 * row is a placeholder. Flagged in the phase record.
 *
 * Before the button, where the mockup leaves space, the row
 * carries the count and the saved dot the Script and Outline toolbars
 * carry (`104 pp · saved` moved into the toolbar row, phase 1), so a write
 * here reports the way a write there does.
 */

export type DisplayOptions = {
  readonly descriptions: boolean
  readonly frames: boolean
}

export const DisplayMenu = memo(
  ({
    display,
    sort,
    filter,
    view,
    onDisplay,
    onSort,
    onFilter,
  }: {
    readonly display: DisplayOptions
    readonly sort: ShotSort
    readonly filter: ShotFilter
    readonly view: StoryboardView
    readonly onDisplay: (display: DisplayOptions) => void
    readonly onSort: (sort: ShotSort) => void
    readonly onFilter: (filter: ShotFilter) => void
  }) => {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    useDismiss(open, () => setOpen(false), root)
    const rows: readonly { readonly key: keyof DisplayOptions; readonly label: string }[] = [
      { key: 'descriptions', label: 'Descriptions' },
      { key: 'frames', label: 'Frames' },
    ]
    const filtered = filter !== 'all'
    return (
      <div ref={root} className="relative">
        <button
          type="button"
          title="Display options"
          aria-haspopup="menu"
          aria-expanded={open}
          data-display-menu
          data-filtered={filtered}
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="folio-pill-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[12px] text-13"
        >
          <Icon name="sliders" size={16} strokeWidth={1.4} />
          {filtered ? SHOT_FILTER_LABEL[filter] : 'Display'}
        </button>
        {open ? (
          <div role="menu" className="folio-menu absolute right-0 top-[40px] w-[230px]">
            <span className="folio-eyebrow px-[9px] pb-[4px] pt-[4px]">Show</span>
            {rows.map((row) => (
              <button
                key={row.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={display[row.key]}
                data-display={row.key}
                className="folio-menu-item"
                onClick={() => {
                  onDisplay({ ...display, [row.key]: !display[row.key] })
                }}
              >
                <span className="min-w-0 flex-1">{row.label}</span>
                {display[row.key] ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
              </button>
            ))}
            {view === 'list' ? (
              <>
                <span className="folio-eyebrow mt-[6px] border-t border-line px-[9px] pb-[4px] pt-[10px]">Sort</span>
                {SHOT_SORTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={value === sort}
                    data-sort={value}
                    className="folio-menu-item"
                    onClick={() => {
                      onSort(value)
                    }}
                  >
                    <span className="min-w-0 flex-1">{SHOT_SORT_LABEL[value]}</span>
                    {value === sort ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
                  </button>
                ))}
              </>
            ) : null}
            <span className="folio-eyebrow mt-[6px] border-t border-line px-[9px] pb-[4px] pt-[10px]">Filter</span>
            {SHOT_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === filter}
                data-filter={value}
                className="folio-menu-item"
                onClick={() => {
                  onFilter(value)
                }}
              >
                <span className="min-w-0 flex-1">{SHOT_FILTER_LABEL[value]}</span>
                {value === filter ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  },
)
DisplayMenu.displayName = 'DisplayMenu'
