'use client'

import type { ProjectId, ResolveItem } from '@folio/contracts'
import { useState } from 'react'

import type { CastFigure } from '../../../../../../lib/characters/cast'
import { setNewCharacterOpen } from '../../../../../../lib/characters/compose'
import { CharacterCard } from './character-card'
import type { Run } from './characters-workspace'
import { UnmatchedQueue } from './unmatched-queue'

/**
 * The Cast view - `Route - Characters v2.dc.html`: the unmatched banner
 * when the queue has rows, then the grid (`repeat(auto-fill, minmax(212px,
 * 1fr))`, 14px gaps) of cards with the dashed `+ New character` tile at
 * its end. `0 20px 24px` around it all, as the mockup's.
 *
 * The banner's ✕ dismisses it for the visit - component state, as the
 * mockup's `unmatched` flag; the rail badge keeps counting. A filter from
 * the toolbar narrows the cards and never the banner.
 */
export const CastView = ({
  projectId,
  figures,
  shown,
  resolve,
  selectedId,
  storage,
  run,
}: {
  readonly projectId: ProjectId
  /** Every record - the banner's cast. */
  readonly figures: readonly CastFigure[]
  /** The records after the toolbar's filter - the grid. */
  readonly shown: readonly CastFigure[]
  readonly resolve: readonly ResolveItem[]
  readonly selectedId: string | null
  readonly storage: boolean
  readonly run: Run
}) => {
  const [dismissed, setDismissed] = useState(false)
  return (
    <div data-cast-view className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
      <div className="flex flex-col gap-[14px]">
        {resolve.length > 0 && !dismissed ? (
          <UnmatchedQueue
            projectId={projectId}
            resolve={resolve}
            cast={figures}
            onDismiss={() => {
              setDismissed(true)
            }}
            run={run}
          />
        ) : null}

        <div data-cast-grid className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))' }}>
          {shown.map((figure) => (
            <CharacterCard key={figure.id} projectId={projectId} figure={figure} selected={figure.id === selectedId} storage={storage} run={run} />
          ))}
          <button
            type="button"
            data-new-character-card
            onClick={() => {
              setNewCharacterOpen(true)
            }}
            className="flex min-h-[240px] cursor-pointer flex-col items-center justify-center gap-[8px] rounded-[14px] border border-dashed border-line bg-transparent text-13 text-ink3 hover:bg-s1 hover:text-ink2"
          >
            <span className="text-18 leading-none">+</span>
            New character
          </button>
        </div>
        {shown.length === 0 && figures.length > 0 ? (
          <p className="m-0 text-12-5 text-ink3" data-cast-filtered-empty>
            No character matches that filter.
          </p>
        ) : null}
      </div>
    </div>
  )
}
