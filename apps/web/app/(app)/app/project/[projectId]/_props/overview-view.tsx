'use client'

import type { ProjectId, PropRow } from '@folio/contracts'

import { setNewPropOpen } from '../../../../../../lib/props/compose'
import type { Run } from '../_chrome/use-run'
import { PropCard } from './prop-card'

/**
 * The Overview: the grid of cards (`repeat(auto-fill, minmax(260px, 1fr))`,
 * 14px gaps) with the dashed `+ New prop` tile at its end - the Places
 * view's grid, minus the queue it has no equivalent of.
 *
 * There is no tree here and no strip of children: a prop is not a sub-prop
 * of a prop (ruling 6), so every record gets a card of its own and the
 * grid is flat.
 *
 * The toolbar's filter and the sidebar's find narrow the cards.
 */
export const OverviewView = ({
  projectId,
  shown,
  selectedId,
  storage,
  run,
  onShowAll,
  total,
}: {
  readonly projectId: ProjectId
  /** The records after the toolbar's filter and the find field. */
  readonly shown: readonly PropRow[]
  readonly selectedId: string | null
  readonly storage: boolean
  readonly run: Run
  readonly onShowAll: () => void
  /** Every record, so a narrowed-to-nothing grid can say so. */
  readonly total: number
}) => (
  <div data-overview-view className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
    <div className="flex flex-col gap-[14px]">
      <div data-props-grid className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {shown.map((row) => (
          <PropCard key={row.id} projectId={projectId} row={row} selected={row.id === selectedId} storage={storage} run={run} />
        ))}
        <button
          type="button"
          data-new-prop-card
          onClick={() => {
            setNewPropOpen(true)
          }}
          className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-[8px] rounded-card border border-dashed border-line bg-transparent text-13 text-ink3 hover:bg-s1 hover:text-ink2"
        >
          <span className="text-18 leading-none">+</span>
          New prop
        </button>
      </div>
      {shown.length === 0 && total > 0 ? (
        <p className="m-0 text-12-5 text-ink3" data-props-filtered-empty>
          No prop matches that filter.{' '}
          <button type="button" data-show-all onClick={onShowAll} className="text-accent hover:underline">
            Show all
          </button>
        </p>
      ) : null}
    </div>
  </div>
)
