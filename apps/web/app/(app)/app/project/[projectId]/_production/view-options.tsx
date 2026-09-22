'use client'

import type { FieldId } from '@folio/contracts'
import { FIELD_LABELS } from '@folio/contracts'
import { useRef, useState } from 'react'

import { fieldMatches, hideAllLabel, reorderFields, toggleAll } from '../../../../../../lib/production/fields'
import { useFocusTrap } from '../_chrome/use-focus-trap'
import { useProduction } from './production-context'

/**
 * §2.4, the view options popover (330px): the Layout segmented control
 * (Cards / Columns), the Metadata list - a switch per field, `Hide all` /
 * `Show all`, a search box - and the `⠿` handle that drag-reorders the
 * fields. The keyboard path for the reorder: with a handle focused,
 * `Alt+↑` / `Alt+↓` move the field one place. Everything persists as a
 * view preference.
 */
export const ViewOptions = ({ onClose }: { readonly onClose: () => void }) => {
  const { prefs, fields, shown, act } = useProduction()
  const [query, setQuery] = useState('')
  const [drag, setDrag] = useState<FieldId | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useFocusTrap(root)

  const move = (id: FieldId, delta: -1 | 1): void => {
    const index = fields.indexOf(id)
    const target = index + delta
    if (target < 0 || target >= fields.length) return
    const before = delta < 0 ? fields[target] : (fields[target + 1] ?? null)
    act.setPrefs({ fieldOrder: [...reorderFields(fields, id, before ?? null)] })
  }

  return (
    <div ref={root} role="dialog" aria-label="View options" data-view-options-popover className="folio-prod-popover folio-prod-options">
      <div className="flex flex-none items-center gap-[8px] px-[14px] pb-[10px] pt-[14px]">
        <span className="text-14 font-medium tracking-title">View options</span>
        <span className="flex-1" />
        <button type="button" title="Close" aria-label="Close" onClick={onClose} className="folio-prod-x">
          ✕
        </button>
      </div>
      <div className="flex flex-none items-center gap-[12px] px-[14px] pb-[12px]">
        <span className="text-12-5 text-ink2">Layout</span>
        <span role="group" aria-label="Layout" className="folio-prod-segment flex-1">
          <button
            type="button"
            title="Cards"
            aria-label="Cards"
            aria-pressed={prefs.view === 'grid'}
            data-layout="grid"
            onClick={() => {
              act.setPrefs({ view: 'grid' })
            }}
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <rect x="2.5" y="2.5" width="5.6" height="5.6" rx="1.2" />
              <rect x="9.9" y="2.5" width="5.6" height="5.6" rx="1.2" />
              <rect x="2.5" y="9.9" width="5.6" height="5.6" rx="1.2" />
              <rect x="9.9" y="9.9" width="5.6" height="5.6" rx="1.2" />
            </svg>
          </button>
          <button
            type="button"
            title="Columns"
            aria-label="Columns"
            aria-pressed={prefs.view === 'list'}
            data-layout="list"
            onClick={() => {
              act.setPrefs({ view: 'list' })
            }}
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <rect x="2.4" y="3.4" width="3.4" height="11.2" rx="1" />
              <rect x="7.3" y="3.4" width="3.4" height="11.2" rx="1" />
              <rect x="12.2" y="3.4" width="3.4" height="11.2" rx="1" />
            </svg>
          </button>
        </span>
      </div>
      <div className="flex flex-none items-center gap-[8px] px-[14px] pb-[8px] pt-[2px]">
        <span className="text-12 text-ink3">Metadata</span>
        <span className="flex-1" />
        <button
          type="button"
          data-hide-all
          onClick={() => {
            act.setPrefs({ fieldVisibility: toggleAll(prefs) })
          }}
          className="folio-prod-linklike"
        >
          {hideAllLabel(prefs)}
        </button>
      </div>
      <div className="flex-none px-[14px] pb-[10px]">
        <label className="folio-prod-search">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="8.2" cy="8.2" r="4.8" />
            <path d="M11.8 11.8l3 3" />
          </svg>
          <input
            type="search"
            value={query}
            placeholder="Search here..."
            aria-label="Search fields"
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
        </label>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[8px] pb-[12px]" role="list" aria-label="Metadata fields">
        {fields
          .filter((id) => fieldMatches(FIELD_LABELS[id], query))
          .map((id) => {
            const on = shown(id)
            return (
              <div
                key={id}
                role="listitem"
                data-field-row={id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  setDrag(id)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (drag !== null && drag !== id) act.setPrefs({ fieldOrder: [...reorderFields(fields, drag, id)] })
                  setDrag(null)
                }}
                onDragEnd={() => {
                  setDrag(null)
                }}
                className="folio-prod-field-row"
                data-dragging={drag === id ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="folio-prod-grip"
                  title="Drag to reorder · Alt+↑ / Alt+↓"
                  aria-label={`Reorder ${FIELD_LABELS[id]}`}
                  onKeyDown={(event) => {
                    if (!event.altKey) return
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      move(id, -1)
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      move(id, 1)
                    }
                  }}
                >
                  ⠿
                </button>
                <span className="min-w-0 flex-1 truncate text-13 text-ink">{FIELD_LABELS[id]}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Show ${FIELD_LABELS[id]}`}
                  data-field-switch={id}
                  onClick={() => {
                    act.setPrefs({ fieldVisibility: { [id]: !on } })
                  }}
                  className="folio-prod-switch"
                >
                  <span className="folio-prod-switch-knob" />
                </button>
              </div>
            )
          })}
      </div>
    </div>
  )
}
