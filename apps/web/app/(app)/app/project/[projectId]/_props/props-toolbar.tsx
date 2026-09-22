'use client'

import { PROP_STATUSES } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { memo, useRef, useState } from 'react'

import { setNewPropOpen } from '../../../../../../lib/props/compose'
import type { StatusFilter } from '../../../../../../lib/props/view'
import { FILTER_LABELS } from '../../../../../../lib/props/view'
import { NewButton, RecordToolbar } from '../_chrome/record-toolbar'
import { useDismiss } from '../_chrome/use-dismiss'

/**
 * The Props toolbar row: the route name, the count chip, `flex: 1`, the
 * `Display` menu and the solid `＋ New` - the shared pieces in
 * `_chrome/record-toolbar.tsx`, with the Storyboard's one-menu shape
 * rather than Locations' bare `All locations ▾`.
 *
 * One menu, one section for now: **Show**, the status filter, narrowing
 * both views. Component state - a way of looking, not an address (the
 * Storyboard's ruling for its `All shots ▾`). The button prints the filter
 * when one is on, so a narrowed list never looks like the whole list; the
 * count chip reads `3 of 8` beside it.
 *
 * The List view's sort is on the List's own column headers (`Name ⇅ ·
 * Category ⇅`), not in here: a sort that is drawn on the thing it sorts
 * does not need a menu, and the Overview is a grid with no columns to
 * sort by.
 *
 * The view switcher is the shell header's (`_props/view-state.tsx`), as
 * every route's is since 2026-09-17. Route toolbars draw no second one.
 */
const FILTERS: readonly StatusFilter[] = ['all', ...PROP_STATUSES]

export const PropsToolbar = memo(
  ({
    count,
    filter,
    onFilter,
  }: {
    /** `8`, or `3 of 8` while narrowed. */
    readonly count: string
    readonly filter: StatusFilter
    readonly onFilter: (filter: StatusFilter) => void
  }) => {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    useDismiss(open, () => setOpen(false), root)
    const filtered = filter !== 'all'
    return (
      <RecordToolbar title="Props" total={count} countAttr="data-prop-count" attr="data-props-toolbar">
        <div ref={root} className="relative">
          <button
            type="button"
            title="Display options"
            aria-haspopup="menu"
            aria-expanded={open}
            data-display-menu
            data-filtered={filtered}
            data-prop-filter={filter}
            onClick={() => {
              setOpen((value) => !value)
            }}
            className="folio-pill-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[12px] text-13"
          >
            <Icon name="sliders" size={16} strokeWidth={1.4} />
            {filtered ? FILTER_LABELS[filter] : 'Display'}
          </button>
          {open ? (
            <div role="menu" className="folio-menu absolute right-0 top-[40px] w-[220px]">
              <span className="folio-eyebrow px-[9px] pb-[4px] pt-[4px]">Show</span>
              {FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option === filter}
                  data-filter-option={option}
                  className={`folio-menu-item ${option === 'needed' ? 'mt-[4px] border-t border-line2 pt-[10px]' : ''}`}
                  onClick={() => {
                    setOpen(false)
                    onFilter(option)
                  }}
                >
                  <span className="min-w-0 flex-1">{FILTER_LABELS[option]}</span>
                  {option === filter ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <NewButton
          attr="data-new-prop"
          onClick={() => {
            setNewPropOpen(true)
          }}
        />
      </RecordToolbar>
    )
  },
)
PropsToolbar.displayName = 'PropsToolbar'
