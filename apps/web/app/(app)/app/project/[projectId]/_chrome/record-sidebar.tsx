'use client'

import type { ReactNode } from 'react'

import { count } from '../../../../../../lib/workspace/format'

/**
 * The record routes' sidebar slots, the parts that are the same on every
 * one - `docs/ui design/README.md`, "Sidebar": "project name and a `+`, a
 * recessed search field, the grouped item list, and one summary widget
 * pinned to the bottom (coverage, budget - whatever that route counts)."
 * The Characters and Locations mockups draw the same four pieces with
 * different content; the layout hands each route's to the shared
 * `Sidebar` card (`_chrome/sidebar.tsx`), and these are the pieces.
 *
 *   `RecordTitleRow`   the project's name and `+` (`New character`, `New
 *                      location`); the find field is `find-field.tsx`
 *   `RecordGroup`      an eyebrow and a count over a route's own rows
 *   `SidebarNote`      the 12px `--ink3` line for an empty or unmatched list
 *   `ProgressWidget`   `Defined 4 / 6` · `Scouted 4 / 6`: a label, `n / m`,
 *                      a 4px accent bar, a note
 *
 * `_characters/cast-sidebar.tsx` carries the same pieces written for one
 * route; it moves onto these when the Characters pass lands.
 */

/** The title row: the project's name and `+`. */
export const RecordTitleRow = ({
  title,
  action,
  attr,
  onAction,
}: {
  readonly title: string
  /** The `+`'s title: `New location`. */
  readonly action: string
  readonly attr: `data-${string}`
  readonly onAction: () => void
}) => (
  <div className="flex flex-none items-center gap-[6px] pb-[10px] pl-[12px] pr-[12px] pt-[14px]">
    <span className="min-w-0 flex-1 truncate text-14 font-medium tracking-title">{title}</span>
    <button
      type="button"
      title={action}
      aria-label={action}
      {...{ [attr]: '' }}
      onClick={onAction}
      className="folio-ghost-button grid h-[24px] w-[24px] place-items-center rounded-[8px] text-15 leading-none text-ink3"
    >
      +
    </button>
  </div>
)

/** One group: the eyebrow and its count, then the route's rows. */
export const RecordGroup = ({
  label,
  total,
  attr,
  countAttr,
  empty,
  children,
}: {
  readonly label: string
  readonly total: number
  readonly attr?: Record<`data-${string}`, string>
  /** The count's own data attribute, for a walk that reads it alone. */
  readonly countAttr?: `data-${string}`
  /** Drawn in place of the list when there is nothing to list - a `SidebarNote`. */
  readonly empty?: ReactNode
  readonly children?: ReactNode
}) => (
  <div className="flex flex-col gap-[2px]" {...attr}>
    <div className="flex items-center pb-[6px] pl-[10px] pr-[10px]">
      <span className="folio-eyebrow flex-1">{label}</span>
      <span className="tabular text-11 text-ink3" {...(countAttr === undefined ? {} : { [countAttr]: '' })}>
        {count(total)}
      </span>
    </div>
    {empty ?? <ul className="m-0 flex list-none flex-col gap-[2px] p-0">{children}</ul>}
  </div>
)

/** The line under the title when there is nothing to list, or nothing that matches. */
export const SidebarNote = ({ attr, children }: { readonly attr: `data-${string}`; readonly children: ReactNode }) => (
  <p className="m-0 ml-[10px] mr-[10px] mt-[2px] text-12 leading-[1.55] text-ink3" {...{ [attr]: '' }}>
    {children}
  </p>
)

/** The `Label N / M` widget pinned at the foot, with its bar and note. */
export const ProgressWidget = ({
  label,
  done,
  total,
  percent,
  note,
  attr,
}: {
  readonly label: string
  readonly done: number
  readonly total: number
  readonly percent: number
  readonly note: string
  /** The card's, the count's and the note's data attributes: `scouted` → `data-scouted-card`, `-count`, `-note`. */
  readonly attr: string
}) => (
  <div {...{ [`data-${attr}-card`]: '' }} className="flex flex-col gap-[7px] rounded-card border border-line2 bg-s1 px-[12px] py-[11px]">
    <div className="flex items-baseline justify-between">
      <span className="text-12 text-ink2">{label}</span>
      <span className="tabular text-13 font-medium" {...{ [`data-${attr}-count`]: '' }}>
        {done} / {total}
      </span>
    </div>
    <div className="h-[4px] overflow-hidden rounded-[3px] bg-s3">
      <div className="h-full rounded-[3px] bg-accent" style={{ width: `${String(percent)}%` }} />
    </div>
    <span className="text-11 text-ink3" {...{ [`data-${attr}-note`]: '' }}>
      {note}
    </span>
  </div>
)
