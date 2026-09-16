'use client'

import { Icon } from '@folio/ui'
import type { ReactNode } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'

/**
 * The sidebar's recessed search field - `docs/ui design/README.md`,
 * "Sidebar": "a recessed search field" - and the query it holds.
 *
 * The field sits in the sidebar card, which is the route layout's, and
 * what it narrows is below it in the same card (a grouped list) and beside
 * it in the page (a grid, a clip list): trees with no channel between them.
 * So the query rides a context the layout wraps both in. Component state,
 * worth no link - a way of looking, not an address (`lib/state/README.md`).
 *
 * `Route - Characters v2.dc.html` draws `Find a character`, `Route -
 * Research v2.dc.html` draws `Search sources and clips`; the geometry is
 * one: `7px 10px` on `--sunk`, a 10px radius, the 13px search glyph at 40%.
 * The Characters route still carries its own copy (`_characters/cast-sidebar.tsx`)
 * from its pass and should take this one at its next.
 */

type Find = { readonly query: string; readonly setQuery: (value: string) => void }

const FindContext = createContext<Find>({ query: '', setQuery: () => undefined })

export const FindProvider = ({ children }: { readonly children: ReactNode }) => {
  const [query, setQuery] = useState('')
  const value = useMemo<Find>(() => ({ query, setQuery }), [query])
  return <FindContext.Provider value={value}>{children}</FindContext.Provider>
}

export const useFind = (): Find => useContext(FindContext)

export const FindField = ({ placeholder, testId }: { readonly placeholder: string; readonly testId: string }) => {
  const { query, setQuery } = useFind()
  return (
    <div className="flex-none px-[10px] pb-[10px]">
      <label className="flex items-center gap-[8px] rounded-[10px] border border-line2 bg-sunk px-[10px] py-[7px]">
        <Icon name="search" size={13} strokeWidth={1.4} className="flex-none opacity-40" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          {...{ [`data-${testId}`]: '' }}
          className="min-w-0 flex-1 border-none bg-transparent text-12-5 text-ink outline-none placeholder:text-ink3"
        />
      </label>
    </div>
  )
}
