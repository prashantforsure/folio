'use client'

import { Icon } from '@folio/ui'
import { memo, useRef, useState } from 'react'

import { SHOT_FILTERS, SHOT_FILTER_LABEL } from '../../../../../../lib/storyboard/board'
import type { ShotFilter } from '../../../../../../lib/storyboard/board'
import { useDismiss } from '../_chrome/use-dismiss'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * The Storyboard's toolbar row - `docs/ui design/Route - Storyboard
 * v2.dc.html`: the view-switcher pill (three icon tabs: scene boards, shot
 * canvas, shot list - the shared `_chrome/view-pill.tsx`, icon shape),
 * `flex: 1`, then `All shots ▾` and the display options. Padding `12px 20px`, 10px gaps.
 *
 * ## What each control does
 *
 *   the pill      three links over `?view=` - the sub-view param
 *                 (`lib/workspace/params.ts`), so a view is a URL.
 *   All shots     a filter over the same rows in every view: all, with a
 *                 frame, waiting on a frame, proposed. Component state.
 *   Display       two toggles, descriptions and frames, for a denser board.
 *
 * The mockup's third button, `Group: Scene ▾`, is not drawn. Shots group by
 * scene and by nothing else - a shot hangs off a heading - and a menu with
 * one row is a placeholder. Flagged in the phase record.
 *
 * Between the pill and the buttons, where the mockup leaves space, the row
 * carries the count and the saved dot the Script and Outline toolbars
 * carry (`104 pp · saved` moved into the toolbar row, phase 1), so a write
 * here reports the way a write there does.
 */

export type StoryboardView = 'board' | 'canvas' | 'list'

export type DisplayOptions = {
  readonly descriptions: boolean
  readonly frames: boolean
}

/** The three tabs of the icon pill (`_chrome/view-pill.tsx`), in the mockup's order. */
export const STORYBOARD_VIEWS: readonly ViewPillItem<StoryboardView>[] = [
  { id: 'board', title: 'Scene boards', icon: 'board' },
  { id: 'canvas', title: 'Shot canvas', icon: 'canvas' },
  { id: 'list', title: 'Shot list', icon: 'list' },
]

export const FilterMenu = memo(({ filter, onPick }: { readonly filter: ShotFilter; readonly onPick: (filter: ShotFilter) => void }) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), root)
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-filter-menu
        onClick={() => {
          setOpen((value) => !value)
        }}
        className="folio-pill-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[13px] text-13"
      >
        {SHOT_FILTER_LABEL[filter]}
        <Icon name="chevron" size={11} strokeWidth={1.5} className="opacity-60" />
      </button>
      {open ? (
        <div role="menu" className="folio-menu absolute right-0 top-[40px] w-[220px]">
          {SHOT_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={value === filter}
              data-filter={value}
              className="folio-menu-item"
              onClick={() => {
                onPick(value)
                setOpen(false)
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
})
FilterMenu.displayName = 'FilterMenu'

export const DisplayMenu = memo(
  ({ display, onChange }: { readonly display: DisplayOptions; readonly onChange: (display: DisplayOptions) => void }) => {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    useDismiss(open, () => setOpen(false), root)
    const rows: readonly { readonly key: keyof DisplayOptions; readonly label: string }[] = [
      { key: 'descriptions', label: 'Descriptions' },
      { key: 'frames', label: 'Frames' },
    ]
    return (
      <div ref={root} className="relative">
        <button
          type="button"
          title="Display options"
          aria-label="Display options"
          aria-haspopup="menu"
          aria-expanded={open}
          data-display-menu
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="folio-pill-button grid h-[34px] w-[34px] place-items-center rounded-[10px]"
        >
          <Icon name="sliders" size={16} strokeWidth={1.4} />
        </button>
        {open ? (
          <div role="menu" className="folio-menu absolute right-0 top-[40px] w-[220px]">
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
                  onChange({ ...display, [row.key]: !display[row.key] })
                }}
              >
                <span className="min-w-0 flex-1">{row.label}</span>
                {display[row.key] ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  },
)
DisplayMenu.displayName = 'DisplayMenu'
