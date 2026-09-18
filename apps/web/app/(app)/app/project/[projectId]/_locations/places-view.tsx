'use client'

import type { LocationRow, ProjectId, SceneRef, SluglineResolveItem } from '@folio/contracts'

import { setNewLocationOpen } from '../../../../../../lib/locations/compose'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { LocationCard } from './location-card'
import type { EpisodeRow } from './locations-workspace'
import { UnmatchedQueue } from './unmatched-queue'

/**
 * The Places view: the queue first while it has rows - a decision waiting
 * is not a notice and cannot be dismissed (the v2 pass's `✕` is gone) -
 * then the grid (`repeat(auto-fill, minmax(260px, 1fr))`, 14px gaps) of
 * cards with the dashed `+ New location` tile at its end.
 *
 * ## A sub-set is drawn inside its parent's card
 *
 * The tree has a shape here at last: a primary set's card carries an
 * `Inside` strip of its sub-sets, and a sub-set gets no card of its own in
 * the grid - it is reachable from the strip, the sidebar and the sheet,
 * and its scenes are counted once, on the parent. A sub-set whose parent
 * the filter hid is drawn as a card, so nothing narrowed out of sight
 * loses its children.
 *
 * The toolbar's filter and the sidebar's find narrow the cards and never
 * the queue.
 */
export const PlacesView = ({
  projectId,
  shape,
  rows,
  shown,
  resolve,
  index,
  episodes,
  selectedId,
  storage,
  run,
  toast,
  onShowAll,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  /** Every record - the queue's picker and the sub-set strips. */
  readonly rows: readonly LocationRow[]
  /** The records after the toolbar's filter and the find field - the grid. */
  readonly shown: readonly LocationRow[]
  readonly resolve: readonly SluglineResolveItem[]
  readonly index: readonly SceneRef[]
  readonly episodes: readonly EpisodeRow[]
  readonly selectedId: string | null
  readonly storage: boolean
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
  readonly onShowAll: () => void
}) => {
  const shownIds = new Set(shown.map((row) => row.id))
  const cards = shown.filter((row) => row.parentId === null || !shownIds.has(row.parentId))
  return (
    <div data-places-view className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
      <div className="flex flex-col gap-[14px]">
        {resolve.length > 0 ? <UnmatchedQueue projectId={projectId} shape={shape} resolve={resolve} rows={rows} run={run} toast={toast} /> : null}

        <div data-places-grid className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {cards.map((row) => (
            <LocationCard
              key={row.id}
              projectId={projectId}
              shape={shape}
              row={row}
              subSets={rows.filter((entry) => entry.parentId === row.id)}
              index={index}
              episodes={episodes}
              selected={row.id === selectedId}
              storage={storage}
              run={run}
              toast={toast}
            />
          ))}
          <button
            type="button"
            data-new-location-card
            onClick={() => {
              setNewLocationOpen(true)
            }}
            className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-[8px] rounded-card border border-dashed border-line bg-transparent text-13 text-ink3 hover:bg-s1 hover:text-ink2"
          >
            <span className="text-18 leading-none">+</span>
            New location
          </button>
        </div>
        {shown.length === 0 && rows.length > 0 ? (
          <p className="m-0 text-12-5 text-ink3" data-places-filtered-empty>
            No location matches that filter.{' '}
            <button type="button" data-show-all onClick={onShowAll} className="text-accent hover:underline">
              Show all
            </button>
          </p>
        ) : null}
      </div>
    </div>
  )
}
