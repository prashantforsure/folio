'use client'

import { useState } from 'react'

/**
 * §5.3, the `date` menu's month calendar: prev / next, today highlighted,
 * the picked day on the accent, `Clear date`. Values are `YYYY-MM-DD`
 * (the `shoot_date` column). Weeks start on Monday, as the mockup draws them.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const iso = (year: number, month: number, day: number): string => `${String(year)}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export const Calendar = ({ value, onPick }: { readonly value: string | null; readonly onPick: (date: string | null) => void }) => {
  const today = new Date()
  const [offset, setOffset] = useState(0)
  const anchor = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const lead = (anchor.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate())
  return (
    <div data-calendar>
      <div className="flex items-center gap-[4px] px-[3px] pb-[7px] pt-[2px]">
        <span className="flex-1 text-12-5 font-medium text-ink" aria-live="polite">
          {MONTHS[month]} {String(year)}
        </span>
        <button
          type="button"
          title="Previous month"
          aria-label="Previous month"
          onClick={() => {
            setOffset((current) => current - 1)
          }}
          className="folio-prod-x h-[22px] w-[22px]"
        >
          ‹
        </button>
        <button
          type="button"
          title="Next month"
          aria-label="Next month"
          onClick={() => {
            setOffset((current) => current + 1)
          }}
          className="folio-prod-x h-[22px] w-[22px]"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-[repeat(7,26px)] gap-[2px] px-[3px]" role="grid" aria-label={`${MONTHS[month] ?? ''} ${String(year)}`}>
        {DAYS.map((day) => (
          <span key={day} role="columnheader" className="grid h-[20px] place-items-center font-mono text-10 text-ink3">
            {day}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${String(i)}`} aria-hidden="true" />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1
          const date = iso(year, month, day)
          const on = value === date
          const isToday = todayIso === date
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-selected={on}
              aria-label={date}
              data-today={isToday ? 'true' : undefined}
              data-on={on ? 'true' : undefined}
              onClick={() => {
                onPick(date)
              }}
              className="folio-prod-day"
            >
              {String(day)}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        data-clear-date
        onClick={() => {
          onPick(null)
        }}
        className="folio-prod-menu-item mt-[7px]"
      >
        Clear date
      </button>
    </div>
  )
}
