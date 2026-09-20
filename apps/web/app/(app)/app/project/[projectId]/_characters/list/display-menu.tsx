'use client'

import { Icon } from '@folio/ui'
import { useRef, useState } from 'react'

import { LIST_COLUMNS } from '../../../../../../../lib/characters/list'
import type { OptionalColumn } from '../../../../../../../lib/characters/list'
import { useDismiss } from '../../_chrome/use-dismiss'

/**
 * The List's `Display` menu (the sliders icon, the Storyboard's word for
 * it): a check per optional column - Words · Share of dialogue · Episodes
 * - and `Export CSV` under a hairline. Component state - which columns
 * are shown is a way of looking, not an address.
 */
export const DisplayMenu = ({
  shown,
  onToggle,
  onExport,
  canExport,
}: {
  readonly shown: ReadonlySet<OptionalColumn>
  readonly onToggle: (column: OptionalColumn) => void
  readonly onExport: () => void
  readonly canExport: boolean
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
        data-display-menu
        className="folio-pill-button flex h-[32px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[12px] text-12-5"
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        <Icon name="sliders" size={14} strokeWidth={1.4} className="opacity-70" />
        Display
      </button>
      {open ? (
        <div role="menu" className="folio-menu absolute right-0 top-[38px] w-[220px]">
          {LIST_COLUMNS.filter((column) => column.optional).map((column) => {
            const id = column.id as OptionalColumn
            return (
              <button
                key={id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={shown.has(id)}
                data-display-column={id}
                className="folio-menu-item"
                onClick={() => {
                  onToggle(id)
                }}
              >
                <span className="min-w-0 flex-1">{column.title}</span>
                {shown.has(id) ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
              </button>
            )
          })}
          <button
            type="button"
            role="menuitem"
            data-export-csv
            disabled={!canExport}
            className="folio-menu-item mt-[4px] border-t border-line2 pt-[10px] disabled:opacity-50"
            onClick={() => {
              setOpen(false)
              onExport()
            }}
          >
            <Icon name="export" size={13} strokeWidth={1.4} className="flex-none opacity-70" />
            <span className="min-w-0 flex-1">Export CSV</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
