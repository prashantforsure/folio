'use client'

import type { LocationRow, ProjectId, SluglineResolveItem } from '@folio/contracts'
import { useState } from 'react'

import { setNewLocationOpen } from '../../../../../../lib/locations/compose'
import type { Run } from '../_chrome/use-run'
import { LocationCard } from './location-card'
import { UnmatchedQueue } from './unmatched-queue'

/**
 * The Places view - `Route - Locations v2.dc.html`: the unmatched banner
 * when the queue has rows, then the grid (`repeat(auto-fill, minmax(248px,
 * 1fr))`, 14px gaps) of cards with the dashed `+ New location` tile at its
 * end. `0 20px 24px` around it all, as the mockup's.
 *
 * The banner's ✕ dismisses it for the visit - component state, as the
 * mockup's `unmatched` flag; the rail badge keeps counting. A filter from
 * the toolbar narrows the cards and never the banner.
 */
export const PlacesView = ({
  projectId,
  rows,
  shown,
  resolve,
  selectedId,
  storage,
  run,
}: {
  readonly projectId: ProjectId
  /** Every record - the queue's picker. */
  readonly rows: readonly LocationRow[]
  /** The records after the toolbar's filter - the grid. */
  readonly shown: readonly LocationRow[]
  readonly resolve: readonly SluglineResolveItem[]
  readonly selectedId: string | null
  readonly storage: boolean
  readonly run: Run
}) => {
  const [dismissed, setDismissed] = useState(false)
  return (
    <div data-places-view className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
      <div className="flex flex-col gap-[14px]">
        {resolve.length > 0 && !dismissed ? (
          <UnmatchedQueue
            projectId={projectId}
            resolve={resolve}
            rows={rows}
            onDismiss={() => {
              setDismissed(true)
            }}
            run={run}
          />
        ) : null}

        <div data-places-grid className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))' }}>
          {shown.map((row) => (
            <LocationCard key={row.id} projectId={projectId} row={row} selected={row.id === selectedId} storage={storage} run={run} />
          ))}
          <button
            type="button"
            data-new-location-card
            onClick={() => {
              setNewLocationOpen(true)
            }}
            className="flex min-h-[230px] cursor-pointer flex-col items-center justify-center gap-[8px] rounded-[14px] border border-dashed border-line bg-transparent text-13 text-ink3 hover:bg-s1 hover:text-ink2"
          >
            <span className="text-18 leading-none">+</span>
            New location
          </button>
        </div>
        {shown.length === 0 && rows.length > 0 ? (
          <p className="m-0 text-12-5 text-ink3" data-places-filtered-empty>
            No location matches that filter.
          </p>
        ) : null}
      </div>
    </div>
  )
}
