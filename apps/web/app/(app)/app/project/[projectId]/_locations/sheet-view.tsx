'use client'

import type { LocationRow, ProjectId } from '@folio/contracts'
import { LOCATION_STATUS_LABELS } from '@folio/contracts'
import { useRouter } from 'next/navigation'

import { dayNightLabel, kindLabel, refLabel, statusTone } from '../../../../../../lib/locations/view'
import { ABSENT, eighths } from '../../../../../../lib/workspace/format'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import { SetMark } from './set-parts'

/**
 * The Sheet view - `Route - Locations v2.dc.html`: a 900px table on `--s1`
 * at a 14px radius; a sticky eyebrow header on `--sunk` (Location · Type
 * 170 · Status 110 · Scenes 70 · Day / Night 110 · Pages 80 · First 80); a
 * row per record - the 26px gradient mark and name, the kind, the status
 * pill in its tone, mono counts, `4 d · 5 n`, the eighths, the first ref -
 * `--s1` on hover and `--s2` while the record is the drawer's. A row opens
 * the drawer.
 *
 * `Pages` and `First` print `—` for a record with no scene or no
 * measurement, the "exists or doesn't" convention (AGENTS.md, UI
 * fidelity); `Scenes` prints `0`, a count that legitimately is one.
 */
export const SheetView = ({
  projectId,
  shown,
  selectedId,
}: {
  readonly projectId: ProjectId
  readonly shown: readonly LocationRow[]
  readonly selectedId: string | null
}) => {
  const router = useRouter()
  return (
    <div data-sheet-view className="min-h-0 flex-1 overflow-auto px-[20px] pb-[20px]">
      <div className="min-w-[900px] overflow-hidden rounded-[14px] border border-line2 bg-s1">
        <div className="folio-eyebrow sticky top-0 z-[4] flex items-center gap-[12px] border-b border-line2 bg-sunk px-[16px] py-[11px]">
          <span className="min-w-0 flex-1">Location</span>
          <span className="w-[170px] flex-none">Type</span>
          <span className="w-[110px] flex-none">Status</span>
          <span className="w-[70px] flex-none">Scenes</span>
          <span className="w-[110px] flex-none">Day / Night</span>
          <span className="w-[80px] flex-none">Pages</span>
          <span className="w-[80px] flex-none">First</span>
        </div>
        {shown.length === 0 ? (
          <p className="m-0 px-[16px] py-[14px] text-12-5 text-ink3" data-sheet-empty>
            No location matches that filter.
          </p>
        ) : (
          shown.map((row) => (
            <button
              key={row.id}
              type="button"
              data-sheet-row={row.id}
              aria-current={row.id === selectedId ? 'true' : undefined}
              onClick={() => {
                router.push(locationHref(projectId, row.id))
              }}
              className="folio-sheet-row"
            >
              <span className="flex min-w-0 flex-1 items-center gap-[10px]" style={{ paddingLeft: row.depth * 14 }}>
                <SetMark id={row.id} />
                <span className="min-w-0 flex-1 truncate text-13">{row.name}</span>
              </span>
              <span className="w-[170px] flex-none truncate text-12-5 text-ink2">{kindLabel(row)}</span>
              <span className="w-[110px] flex-none">
                <span className="folio-tone-pill" data-size="sheet" data-tone={statusTone(row.status)}>
                  {LOCATION_STATUS_LABELS[row.status]}
                </span>
              </span>
              <span className="tabular w-[70px] flex-none font-mono text-12 text-ink2">{row.rollup.scenes}</span>
              <span className="tabular w-[110px] flex-none font-mono text-11-5 text-ink2">{dayNightLabel(row.rollup)}</span>
              <span className="tabular w-[80px] flex-none font-mono text-11-5 text-ink3">{eighths(row.eighths)}</span>
              <span className="w-[80px] flex-none font-mono text-11-5 text-ink3">{row.firstSeen === null ? ABSENT : refLabel(row.firstSeen)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
