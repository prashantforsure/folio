'use client'

import type { CastRow, ProjectId, ResolveItem } from '@folio/contracts'

import { CharacterCard } from './character-card'
import type { Run } from './characters-workspace'
import { UnmatchedCard } from './unmatched-card'

/**
 * The Overview: every record as a card, then every unmatched name as a
 * ghost card. The grid is the list - there is no column beside it. The
 * find box in the header filters both by name and role; with nothing
 * matching, one line says so.
 */
export const OverviewGrid = ({
  projectId,
  cast,
  resolve,
  query,
  storage,
  run,
}: {
  readonly projectId: ProjectId
  readonly cast: readonly CastRow[]
  readonly resolve: readonly ResolveItem[]
  readonly query: string
  readonly storage: boolean
  readonly run: Run
}) => {
  const needle = query.trim().toLowerCase()
  const matches = (name: string, role: string | null): boolean =>
    needle === '' || name.toLowerCase().includes(needle) || (role ?? '').toLowerCase().includes(needle)
  const cards = cast.filter((row) => matches(row.name, row.role))
  const ghosts = resolve.filter((row) => matches(row.cue, null))

  return (
    <div className="min-w-0 flex-1 overflow-auto px-[24px] pb-[60px] pt-[20px]" data-overview-grid>
      {cards.length === 0 && ghosts.length === 0 ? (
        <div className="py-[40px] text-center text-12 text-ink3">Nobody matches “{query.trim()}”.</div>
      ) : (
        <div className="grid gap-[16px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {cards.map((row) => (
            <CharacterCard key={row.id} projectId={projectId} row={row} storage={storage} run={run} />
          ))}
          {ghosts.map((row) => (
            <UnmatchedCard key={row.key} projectId={projectId} row={row} cast={cast} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}
