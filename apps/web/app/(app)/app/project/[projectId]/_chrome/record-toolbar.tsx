'use client'

import { Icon } from '@folio/ui'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

import { useDismiss } from './use-dismiss'

/**
 * The record routes' toolbar pieces - `docs/ui design/README.md`,
 * "Toolbar": "Route name, a count chip, then the view-switcher pill ...
 * then `flex:1`, then secondary buttons and one solid primary action. It
 * wraps rather than overflows." `12px 20px`, 10px gaps.
 *
 *   `RecordToolbar`   the row: the `h1`, the count chip, the pill the route
 *                     hands in (`_chrome/view-pill.tsx`), `flex: 1`, then
 *                     the route's right-hand controls
 *   `FilterMenu`      `All characters ▾` / `All locations ▾`: a menu of
 *                     options with a check on the current one; `dividers`
 *                     names the indexes a hairline sits above. Component
 *                     state - a way of looking, not an address (the
 *                     Storyboard's ruling for its `All shots ▾`)
 *   `NewButton`       the one solid primary: `＋ New`
 */
export const RecordToolbar = ({
  title,
  total,
  countAttr,
  pill,
  attr,
  children,
}: {
  readonly title: string
  /** The count chip: a number, or the worded form a mockup writes (`8 sources`, `7 clips`). */
  readonly total: number | string
  readonly countAttr: `data-${string}`
  readonly pill: ReactNode
  readonly attr: `data-${string}`
  /** The right-hand controls, after `flex: 1`. */
  readonly children: ReactNode
}) => (
  <div {...{ [attr]: '' }} className="flex flex-none flex-wrap items-center gap-[10px] px-[20px] py-[12px]">
    <h1 className="m-0 whitespace-nowrap text-14 font-medium leading-normal tracking-title">{title}</h1>
    <span className="tabular whitespace-nowrap rounded-pill bg-s2 px-[10px] py-[4px] text-11-5 text-ink2" {...{ [countAttr]: '' }}>
      {total}
    </span>
    <div className="ml-[4px] min-w-0">{pill}</div>
    <div className="flex-1" />
    {children}
  </div>
)

export const FilterMenu = <T extends string>({
  value,
  options,
  label,
  dividers = [],
  attr,
  onPick,
}: {
  readonly value: T
  readonly options: readonly T[]
  readonly label: (option: T) => string
  /** Indexes in `options` a hairline sits above. */
  readonly dividers?: readonly number[]
  readonly attr: `data-${string}`
  readonly onPick: (option: T) => void
}) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), root)
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        {...{ [attr]: value }}
        className="folio-pill-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[13px] text-12-5"
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        {label(value)}
        <Icon name="chevron" size={11} strokeWidth={1.5} className="opacity-60" />
      </button>
      {open ? (
        <div role="menu" className="folio-menu absolute right-0 top-[40px] w-[220px]">
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === value}
              data-filter-option={option}
              className={`folio-menu-item ${dividers.includes(index) ? 'mt-[4px] border-t border-line2 pt-[10px]' : ''}`}
              onClick={() => {
                setOpen(false)
                onPick(option)
              }}
            >
              <span className="min-w-0 flex-1">{label(option)}</span>
              {option === value ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const NewButton = ({
  attr,
  label = '＋ New',
  onClick,
}: {
  readonly attr: `data-${string}`
  /** The mockup's label when it is not `＋ New`: `＋ Add source`. */
  readonly label?: string
  readonly onClick: () => void
}) => (
  <button
    type="button"
    {...{ [attr]: '' }}
    onClick={onClick}
    className="folio-solid-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[14px] text-12-5 font-medium"
  >
    {label}
  </button>
)
