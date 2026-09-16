'use client'

import type { ProjectId, ResolveItem } from '@folio/contracts'
import { useState } from 'react'

import { resolveCue } from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import { unmatchedLabel } from '../../../../../../lib/characters/cast'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import { CitationChips } from '../_chrome/citation-chips'
import type { Run } from './characters-workspace'

/**
 * The names in the script that point at no record - `Route - Characters
 * v2.dc.html`'s banner over the grid: a `--warn` dot, `3 names in the
 * script don't match a character`, `Review`, and ✕ to dismiss for the
 * visit. The mockup gives `Review` no behaviour; here it unfolds the queue
 * in place - one row per open cue (the resolve queue, AGENTS.md: "rows,
 * not a computed view"): the cue in mono, how many, its citations, and
 * the decision:
 *
 *   `This is <name>` / `New character`   take the row's own proposal
 *   `Someone else…`                       a record from the cast, or a new one
 *   `Not a character`                     the cue is nobody; never asked again
 *
 * Every answer writes `resolve_decisions`, re-derives, and the grid
 * re-renders from the pass. The script text is never changed. A cue whose
 * proposal names a record is also that record's conflict block on its
 * card; either door decides the same row.
 */
export const UnmatchedQueue = ({
  projectId,
  resolve,
  cast,
  onDismiss,
  run,
}: {
  readonly projectId: ProjectId
  readonly resolve: readonly ResolveItem[]
  readonly cast: readonly CastFigure[]
  readonly onDismiss: () => void
  readonly run: Run
}) => {
  const [open, setOpen] = useState(false)
  return (
    <div data-unmatched-banner data-open={open ? 'true' : 'false'} className="flex flex-col rounded-[11px] border border-line2 bg-s1">
      <div className="flex items-center gap-[12px] px-[14px] py-[10px]">
        <span className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
        <span className="min-w-0 flex-1 text-12-5 text-ink2" data-unmatched-count={resolve.length}>
          {unmatchedLabel(resolve.length)}
        </span>
        <button
          type="button"
          data-unmatched-review
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="folio-line-button h-[28px] flex-none rounded-[8px] px-[12px] text-12"
          data-line="strong"
        >
          {open ? 'Close' : 'Review'}
        </button>
        <button
          type="button"
          title="Dismiss"
          aria-label="Dismiss"
          data-unmatched-dismiss
          onClick={onDismiss}
          className="folio-ghost-button grid h-[24px] w-[24px] flex-none place-items-center rounded-[7px] text-11 text-ink3"
        >
          ✕
        </button>
      </div>
      {open ? (
        <ul className="m-0 flex list-none flex-col border-t border-line2 p-0">
          {resolve.map((item) => (
            <QueueRow key={item.key} projectId={projectId} item={item} cast={cast} run={run} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

type Choice =
  | { readonly kind: 'proposal' }
  | { readonly kind: 'character'; readonly id: string }
  | { readonly kind: 'new-record' }
  | { readonly kind: 'walk-on' }

const QueueRow = ({
  projectId,
  item,
  cast,
  run,
}: {
  readonly projectId: ProjectId
  readonly item: ResolveItem
  readonly cast: readonly CastFigure[]
  readonly run: Run
}) => {
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const proposal = item.proposal

  const decide = (choice: Choice): void => {
    setBusy(true)
    setChoosing(false)
    run(async () => {
      const result = await resolveCue(projectId, item.key, choice)
      setBusy(false)
      return result.status === 'resolved' ? null : result.message
    })
  }

  return (
    <li
      data-unmatched-row={item.key}
      data-busy={busy ? 'true' : 'false'}
      className={`flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-line2 px-[14px] py-[10px] last:border-b-0 ${busy ? 'opacity-60' : ''}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <span className="flex items-baseline gap-[8px]">
          <span className="font-mono text-12-5 text-ink" data-unmatched-cue>
            {item.cue}
          </span>
          <span className="tabular text-11 text-ink3">
            {item.occurrences} {item.occurrences === 1 ? 'cue' : 'cues'}
          </span>
        </span>
        <CitationChips refs={item.scenes.map(formatSceneRef)} />
      </span>
      <span className="flex flex-none flex-wrap items-center gap-[6px]">
        {proposal !== null && !choosing ? (
          <button
            type="button"
            disabled={busy}
            data-unmatched-match
            onClick={() => {
              decide({ kind: 'proposal' })
            }}
            className="folio-solid-button h-[28px] rounded-[8px] px-[12px] text-12 font-medium"
          >
            {proposal.kind === 'character' ? `This is ${proposal.name}` : 'New character'}
          </button>
        ) : null}
        {choosing ? (
          <select
            autoFocus
            aria-label="Who is this"
            data-unmatched-pick
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value
              if (value === '') return
              if (value === 'new-record') decide({ kind: 'new-record' })
              else decide({ kind: 'character', id: value })
            }}
            onBlur={() => {
              setChoosing(false)
            }}
            className="folio-field h-[28px] rounded-[8px] py-0 text-12"
          >
            <option value="">Who is this?</option>
            {cast.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
            <option value="new-record">＋ New character</option>
          </select>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              data-unmatched-other
              onClick={() => {
                setChoosing(true)
              }}
              className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
            >
              Someone else…
            </button>
            <button
              type="button"
              disabled={busy}
              data-unmatched-walk-on
              onClick={() => {
                decide({ kind: 'walk-on' })
              }}
              className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
            >
              Not a character
            </button>
          </>
        )}
      </span>
    </li>
  )
}
