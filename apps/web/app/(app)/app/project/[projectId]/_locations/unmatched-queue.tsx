'use client'

import type { LocationRow, ProjectId, SluglineResolveItem } from '@folio/contracts'
import { useState } from 'react'

import { resolveSlugline } from '../../../../../../lib/locations/actions'
import { refLabel, unmatchedLabel } from '../../../../../../lib/locations/view'
import { CitationChips } from '../_chrome/citation-chips'
import type { Run } from '../_chrome/use-run'

/**
 * The sluglines in the script that point at no record - `Route - Locations
 * v2.dc.html`'s banner over the grid: a `--warn` dot, `3 sluglines don't
 * point at a location`, `Review`, and ✕ to dismiss for the visit. The
 * mockup gives `Review` no behaviour; here it unfolds the queue in place -
 * one row per open slugline (the resolve queue, AGENTS.md: "rows, not a
 * computed view"): the set text in mono, how many headings, its
 * citations, and the decision:
 *
 *   `This is <name>` / `New location`   take the row's own proposal
 *   `Somewhere else…`                   a record from the list, or a new one
 *
 * Every answer writes `resolve_decisions`, re-derives, and the grid
 * re-renders from the pass. The script text is never changed. There is no
 * "not a location" here as there is "not a character" for a cue: a scene
 * heading always names a place.
 */
export const UnmatchedQueue = ({
  projectId,
  resolve,
  rows,
  onDismiss,
  run,
}: {
  readonly projectId: ProjectId
  readonly resolve: readonly SluglineResolveItem[]
  readonly rows: readonly LocationRow[]
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
            <QueueRow key={item.key} projectId={projectId} item={item} rows={rows} run={run} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

type Choice = { readonly kind: 'proposal' } | { readonly kind: 'location'; readonly id: string } | { readonly kind: 'new-record' }

const QueueRow = ({
  projectId,
  item,
  rows,
  run,
}: {
  readonly projectId: ProjectId
  readonly item: SluglineResolveItem
  readonly rows: readonly LocationRow[]
  readonly run: Run
}) => {
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const proposal = item.proposal

  const decide = (choice: Choice): void => {
    setBusy(true)
    setChoosing(false)
    run(async () => {
      const result = await resolveSlugline(projectId, item.key, choice)
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
          <span className="font-mono text-12-5 uppercase text-ink" data-unmatched-slugline>
            {item.slugline}
          </span>
          <span className="tabular text-11 text-ink3">
            {item.occurrences} {item.occurrences === 1 ? 'heading' : 'headings'}
          </span>
        </span>
        <CitationChips refs={item.scenes.map(refLabel)} />
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
            {proposal.kind === 'location' ? `This is ${proposal.name}` : 'New location'}
          </button>
        ) : null}
        {choosing ? (
          <select
            autoFocus
            aria-label="Where is this"
            data-unmatched-pick
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value
              if (value === '') return
              if (value === 'new-record') decide({ kind: 'new-record' })
              else decide({ kind: 'location', id: value })
            }}
            onBlur={() => {
              setChoosing(false)
            }}
            className="folio-field h-[28px] rounded-[8px] py-0 text-12"
          >
            <option value="">Where is this?</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.depth > 0 ? `${'  '.repeat(row.depth)}${row.name}` : row.name}
              </option>
            ))}
            <option value="new-record">＋ New location</option>
          </select>
        ) : (
          <button
            type="button"
            disabled={busy}
            data-unmatched-other
            onClick={() => {
              setChoosing(true)
            }}
            className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
          >
            Somewhere else…
          </button>
        )}
      </span>
    </li>
  )
}
