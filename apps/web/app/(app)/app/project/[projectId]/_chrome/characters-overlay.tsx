'use client'

import type { ProjectId } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { peekCharacters } from '../../../../../../lib/characters/peek'
import type { PeekRow } from '../../../../../../lib/characters/peek'
import { characterHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'

/**
 * The Characters overlay: the 330px peek the rail opens over a writing route
 * (`Route - Script v2.dc.html`, "CONTEXT OVERLAY (rail panel)"). A floating
 * `--sunk` card at `left: 56px`, the list, and `New character` at the foot.
 *
 * Ruled 2026-09-16: the rail's Characters icon opens this on the writing
 * routes, with the full route linked from inside - the `⋯` slot in the
 * mockup becomes an "Open Characters" link, and a row opens that
 * character's drawer on `/characters/:id`. The list is read when the overlay
 * opens (`lib/characters/peek.ts`), not carried by every navigation.
 *
 * `New character` links to the route. Its modal is component state and the
 * route has no param that opens it (AGENTS.md, When to ask first: adding a
 * query param needs a human), so the header's `New Character` is one more
 * click away there. Flagged in the phase record.
 */
export const CharactersOverlay = ({
  projectId,
  projectTitle,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly onClose: () => void
}) => {
  const [rows, setRows] = useState<readonly PeekRow[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void peekCharacters(projectId).then((result) => {
      if (cancelled) return
      if (result.status === 'ok') setRows(result.rows)
      else setNotice(result.message)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  return (
    <div
      role="dialog"
      aria-label={`Characters in ${projectTitle}`}
      data-characters-overlay
      className="folio-overlay absolute bottom-[10px] left-[56px] top-[10px] z-[6] flex w-[330px] flex-col"
    >
      <div className="flex flex-none items-center gap-[8px] pb-[10px] pl-[16px] pr-[12px] pt-[14px]">
        <span className="flex-1 text-14 font-medium">Characters</span>
        <Link
          href={projectRouteHref(projectId, 'characters')}
          title="Open Characters"
          className="folio-ghost-button rounded-[8px] px-[8px] py-[4px] text-12 text-ink2 no-underline hover:no-underline"
        >
          Open
        </Link>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="folio-ghost-button grid h-[26px] w-[26px] place-items-center rounded-[8px] text-ink3"
        >
          <Icon name="close" size={13} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[4px] overflow-y-auto px-[12px] pb-[16px] pt-[4px]">
        {notice !== null ? <p className="m-0 px-[10px] text-12 text-live">{notice}</p> : null}
        {rows === null && notice === null ? <p className="m-0 px-[10px] text-12 text-ink3">Reading the cast…</p> : null}
        {rows !== null && rows.length === 0 ? (
          <p className="m-0 px-[10px] text-12 leading-[1.55] text-ink3">
            No characters yet. Cues in the script become records on the Characters route.
          </p>
        ) : null}
        {rows?.map((row) =>
          row.characterId === null ? (
            <div key={row.key} className="flex w-full items-center gap-[11px] rounded-[11px] px-[10px] py-[9px] text-left" data-peek-row="cue">
              <PeekChip row={row} />
              <PeekText row={row} />
              <span className="flex-none rounded-pill bg-s2 px-[8px] py-[3px] text-10-5 text-warn">unresolved</span>
            </div>
          ) : (
            <Link
              key={row.key}
              href={characterHref(projectId, row.characterId)}
              data-peek-row="character"
              className="folio-ghost-button flex w-full items-center gap-[11px] rounded-[11px] px-[10px] py-[9px] text-left text-ink no-underline hover:no-underline"
            >
              <PeekChip row={row} />
              <PeekText row={row} />
            </Link>
          ),
        )}
      </div>

      <div className="flex-none px-[12px] pb-[14px]">
        <Link
          href={projectRouteHref(projectId, 'characters')}
          className="folio-pill-button flex w-full items-center justify-center rounded-[11px] px-[10px] py-[10px] text-13 text-ink2 no-underline hover:no-underline"
        >
          New character
        </Link>
      </div>
    </div>
  )
}

const PeekChip = ({ row }: { readonly row: PeekRow }) => (
  <span
    className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] text-11 font-semibold"
    style={
      row.hue === null
        ? { background: 'var(--s3)', color: 'var(--ink2)' }
        : { background: `var(--chip-${String(row.hue)})`, color: 'var(--chip-ink)' }
    }
  >
    {row.initials}
  </span>
)

const PeekText = ({ row }: { readonly row: PeekRow }) => (
  <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
    <span className="truncate text-13 text-ink">{row.name}</span>
    <span className="truncate text-11-5 text-ink3">{row.meta}</span>
  </span>
)
