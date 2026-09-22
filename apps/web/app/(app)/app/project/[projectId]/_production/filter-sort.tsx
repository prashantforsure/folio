'use client'

import { SORT_MODES, SORT_MODE_LABELS, STATUS_FILTERS, STATUS_FILTER_LABELS } from '@folio/contracts'
import { useRef } from 'react'

import { useFocusTrap } from '../_chrome/use-focus-trap'
import { useProduction } from './production-context'

/**
 * §2.5, the filter & sort popover (270px): Status chips (`All` · `To draw`
 * · `Drawn` · `Needs attention`), the `Unassigned only` toggle, and Sort
 * (`Scene order` · `Longest first` · `By status`). Each pick persists as a
 * view preference.
 */
export const FilterSort = () => {
  const { prefs, act } = useProduction()
  const root = useRef<HTMLDivElement>(null)
  useFocusTrap(root)
  return (
    <div ref={root} role="dialog" aria-label="Filter and sort" data-filter-popover className="folio-prod-popover folio-prod-filter">
      <span className="flex flex-col gap-[8px]">
        <span className="text-11-5 text-ink3">Status</span>
        <span role="radiogroup" aria-label="Status" className="flex flex-wrap gap-[6px]">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              role="radio"
              aria-checked={prefs.statusFilter === filter}
              data-status-filter={filter}
              onClick={() => {
                act.setPrefs({ statusFilter: filter })
              }}
              className="folio-prod-chipbtn"
            >
              {STATUS_FILTER_LABELS[filter]}
            </button>
          ))}
        </span>
      </span>
      <span className="flex flex-col gap-[8px]">
        <span className="text-11-5 text-ink3">Assignee</span>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.unassignedOnly}
          data-unassigned-only
          onClick={() => {
            act.setPrefs({ unassignedOnly: !prefs.unassignedOnly })
          }}
          className="folio-prod-chipbtn self-start"
        >
          Unassigned only
        </button>
      </span>
      <span className="flex flex-col gap-[8px]">
        <span className="text-11-5 text-ink3">Sort</span>
        <span role="radiogroup" aria-label="Sort" className="flex flex-wrap gap-[6px]">
          {SORT_MODES.map((sort) => (
            <button
              key={sort}
              type="button"
              role="radio"
              aria-checked={prefs.sort === sort}
              data-sort={sort}
              onClick={() => {
                act.setPrefs({ sort })
              }}
              className="folio-prod-chipbtn"
            >
              {SORT_MODE_LABELS[sort]}
            </button>
          ))}
        </span>
      </span>
    </div>
  )
}
