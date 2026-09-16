'use client'

import type { ProjectId } from '@folio/contracts'
import { CHARACTER_STATUS_LABELS } from '@folio/contracts'
import { useRouter } from 'next/navigation'

import type { CastFigure } from '../../../../../../lib/characters/cast'
import { statusTone } from '../../../../../../lib/characters/cast'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import { ABSENT } from '../../../../../../lib/workspace/format'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { CastMark } from './cast-mark'

/**
 * The Sheet view - `Route - Characters v2.dc.html`: an 880px table on
 * `--s1` at a 14px radius; a sticky eyebrow header on `--sunk` (Name ·
 * Role 190 · Status 110 · Scenes 70 · Lines 70 · First 90 · Last 90); a
 * row per record - the 26px chip and name, the role, the status pill in
 * its tone, mono counts, mono refs - `--s1` on hover and `--s2` while the
 * record is the drawer's. A row opens the drawer.
 *
 * `First` / `Last` print `—` for a record with no scene, the "exists or
 * doesn't" convention (AGENTS.md, UI fidelity).
 */
export const SheetView = ({
  projectId,
  shown,
  selectedId,
}: {
  readonly projectId: ProjectId
  readonly shown: readonly CastFigure[]
  readonly selectedId: string | null
}) => {
  const router = useRouter()
  return (
    <div data-sheet-view className="min-h-0 flex-1 overflow-auto px-[20px] pb-[20px]">
      <div className="min-w-[880px] overflow-hidden rounded-[14px] border border-line2 bg-s1">
        <div className="folio-eyebrow sticky top-0 z-[4] flex items-center gap-[12px] border-b border-line2 bg-sunk px-[16px] py-[11px]">
          <span className="min-w-0 flex-1">Name</span>
          <span className="w-[190px] flex-none">Role</span>
          <span className="w-[110px] flex-none">Status</span>
          <span className="w-[70px] flex-none">Scenes</span>
          <span className="w-[70px] flex-none">Lines</span>
          <span className="w-[90px] flex-none">First</span>
          <span className="w-[90px] flex-none">Last</span>
        </div>
        {shown.length === 0 ? (
          <p className="m-0 px-[16px] py-[14px] text-12-5 text-ink3" data-sheet-empty>
            No character matches that filter.
          </p>
        ) : (
          shown.map((figure) => (
            <button
              key={figure.id}
              type="button"
              data-sheet-row={figure.id}
              aria-current={figure.id === selectedId ? 'true' : undefined}
              onClick={() => {
                router.push(characterHref(projectId, figure.id))
              }}
              className="folio-sheet-row"
            >
              <span className="flex min-w-0 flex-1 items-center gap-[10px]">
                <CastMark initial={figure.initial} hue={figure.hue} size={26} radius={8} fontSize={10} />
                <span className="min-w-0 flex-1 truncate text-13">{figure.name}</span>
              </span>
              <span className="w-[190px] flex-none truncate text-12-5 text-ink2">{figure.role ?? ABSENT}</span>
              <span className="w-[110px] flex-none">
                <span className="folio-tone-pill" data-size="sheet" data-tone={statusTone(figure.status)}>
                  {CHARACTER_STATUS_LABELS[figure.status]}
                </span>
              </span>
              <span className="tabular w-[70px] flex-none font-mono text-12 text-ink2">{figure.appearances}</span>
              <span className="tabular w-[70px] flex-none font-mono text-12 text-ink2">{figure.lines}</span>
              <span className="w-[90px] flex-none font-mono text-11-5 text-ink3">{figure.first === null ? ABSENT : formatSceneRef(figure.first)}</span>
              <span className="w-[90px] flex-none font-mono text-11-5 text-ink3">{figure.last === null ? ABSENT : formatSceneRef(figure.last)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
