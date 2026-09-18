'use client'

import type { ProjectId, ResolveItem } from '@folio/contracts'
import { useEffect, useState } from 'react'

import { revokeDecision } from '../../../../../../lib/characters/actions'
import { setQueueIntent, useQueueIntent } from '../../../../../../lib/characters/compose'
import { citeOf } from '../../../../../../lib/characters/figures'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import type { Run } from '../_chrome/use-run'

/**
 * The walk-ons, under the queue: the cues the writer said are nobody -
 * `CROWD`, `VOICE`, `WAITER` - which the pass keeps open with no proposal
 * and never asks about again. Before 2026-09-17 they were drawn nowhere,
 * so a mis-click on a 400-cue name was permanent. One line, folded: `2
 * walk-ons · CROWD, VOICE` and `Show`; open, one row per cue with its
 * citations and `Actually a character`, which takes the decision back
 * (`revokeDecision`) and puts the cue in the queue again.
 */
export const WalkOnsLine = ({
  projectId,
  shape,
  walkOns,
  run,
  onRevoked,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly walkOns: readonly ResolveItem[]
  readonly run: Run
  readonly onRevoked: (item: ResolveItem) => void
}) => {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const intent = useQueueIntent()
  useEffect(() => {
    if (intent !== 'walk-ons') return
    setOpen(true)
    setQueueIntent(null)
  }, [intent])

  const revoke = (item: ResolveItem): void => {
    setBusy(item.key)
    run(async () => {
      const result = await revokeDecision(projectId, item.key, { kind: 'walk-on' })
      setBusy(null)
      if (result.status !== 'resolved') return result.message
      onRevoked(item)
      return null
    })
  }

  return (
    <div data-walk-ons={walkOns.length} data-open={open ? 'true' : 'false'} className="flex flex-col rounded-card border border-line2 bg-s1">
      <div className="flex items-center gap-[12px] px-[14px] py-[10px]">
        <span className="min-w-0 flex-1 truncate text-12-5 text-ink2">
          {walkOns.length} {walkOns.length === 1 ? 'walk-on' : 'walk-ons'} ·{' '}
          <span className="font-mono text-12 text-ink3">{walkOns.map((item) => item.cue).join(', ')}</span>
        </span>
        <button
          type="button"
          data-walk-ons-toggle
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="folio-ghost-button h-[26px] flex-none rounded-[7px] px-[8px] text-12 text-ink3 hover:!text-ink2"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open ? (
        <ul className="m-0 flex list-none flex-col border-t border-line2 p-0">
          {walkOns.map((item) => (
            <li
              key={item.key}
              data-walk-on-row={item.cue}
              className={`flex flex-wrap items-center gap-x-[12px] gap-y-[6px] border-b border-line2 px-[14px] py-[9px] last:border-b-0 ${busy === item.key ? 'opacity-60' : ''}`}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <span className="flex items-baseline gap-[8px]">
                  <span className="font-mono text-12-5 text-ink">{item.cue}</span>
                  <span className="tabular text-11 text-ink3">
                    {item.occurrences} {item.occurrences === 1 ? 'cue' : 'cues'}
                  </span>
                </span>
                <CitationChips refs={item.scenes.map((ref) => citeOf(projectId, shape, ref))} />
              </span>
              <button
                type="button"
                disabled={busy !== null}
                data-walk-on-revoke
                onClick={() => {
                  revoke(item)
                }}
                className="folio-line-button h-[28px] flex-none rounded-[8px] px-[10px] text-12"
              >
                Actually a character
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
