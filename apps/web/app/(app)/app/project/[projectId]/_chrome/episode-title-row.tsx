'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import { useEffect, useRef, useState } from 'react'

import { episodeLabel } from '../../../../../../lib/workspace/format'
import { EpisodeForm } from './episode-form'
import type { EpisodeFormMode } from './episode-form'

/**
 * The sidebar's title row for a series: `Episode 1 · Standpipe` and `+`.
 *
 * The name is a button titled "Rename episode" - the idiom the Production
 * mockup uses for a reel (`title="Rename reel"` on the name itself) - and
 * `+` is "New episode", 24x24, the plain plus the v2 mockups draw at 15px.
 * Either opens the episode form **in flow** under the row, wrapping onto
 * the row's second line: the sidebar card clips its overflow (the 16px
 * radius needs it), so a popover inside it would be cut at the card's edge
 * - the same clipping that hid the header's episode menu. The row is
 * `flex-wrap` for this reason.
 *
 * An episode is named at birth now (the client asked, 2026-09-16 - "no one
 * asks for the name"); the form is the one the header's episode menu opens,
 * so the two doors lead to the same room. The create action refuses for a
 * film; this row is simply not rendered for one.
 */
export const EpisodeTitleRow = ({
  projectId,
  slug,
  ordinal,
  title,
  nextOrdinal,
}: {
  readonly projectId: ProjectId
  readonly slug: EpisodeSlug
  readonly ordinal: number
  readonly title: string
  readonly nextOrdinal: number
}) => {
  const [mode, setMode] = useState<EpisodeFormMode | null>(null)
  const row = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode === null) return undefined
    const onDown = (event: MouseEvent): void => {
      if (row.current !== null && event.target instanceof Node && !row.current.contains(event.target)) setMode(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
    }
  }, [mode])

  const close = (): void => {
    setMode(null)
  }

  return (
    <div ref={row} data-episode-title-row className="flex flex-none flex-wrap items-center gap-[6px] pb-[10px] pl-[12px] pr-[12px] pt-[14px]">
      <button
        type="button"
        title="Rename episode"
        aria-haspopup="dialog"
        aria-expanded={mode?.kind === 'rename'}
        data-episode-rename
        onClick={() => {
          setMode((value) => (value?.kind === 'rename' ? null : { kind: 'rename', slug, ordinal, title }))
        }}
        className="folio-ghost-button -ml-[8px] min-w-0 flex-1 truncate rounded-[8px] px-[8px] py-[4px] text-left text-14 font-medium tracking-title text-ink"
      >
        {episodeLabel(ordinal, title)}
      </button>
      <button
        type="button"
        title="New episode"
        aria-label="New episode"
        aria-haspopup="dialog"
        aria-expanded={mode?.kind === 'create'}
        data-new-episode
        onClick={() => {
          setMode((value) => (value?.kind === 'create' ? null : { kind: 'create', nextOrdinal }))
        }}
        className="folio-ghost-button grid h-[24px] w-[24px] flex-none place-items-center rounded-[8px] text-15 leading-none text-ink3"
      >
        +
      </button>
      {mode === null ? null : (
        <div
          role="dialog"
          aria-label={mode.kind === 'create' ? 'New episode' : 'Rename episode'}
          data-episode-panel={mode.kind}
          className="mt-[6px] w-full rounded-card border border-line2 bg-sunk"
        >
          <EpisodeForm key={mode.kind} projectId={projectId} mode={mode} onDone={close} onCancel={close} />
        </div>
      )}
    </div>
  )
}
