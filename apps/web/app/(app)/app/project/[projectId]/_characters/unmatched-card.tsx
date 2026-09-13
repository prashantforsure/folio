'use client'

import type { CastRow, ProjectId, ResolveItem } from '@folio/contracts'
import { useState } from 'react'

import { resolveCue } from '../../../../../../lib/characters/actions'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import type { Run } from './characters-workspace'
import { CharacterChip } from './chip'

/**
 * A name in the script that points at no record, drawn as a ghost card at
 * the end of the grid: the cue in Courier, where it occurs, and the
 * decision. This is the resolve queue - AGENTS.md, Entity identity: "rows,
 * not a computed view" - with no screen of its own. Three answers:
 *
 *   `This is <name> ✓`   take the proposal: bind the spelling to that
 *                        record, or mint a new one when the proposal is
 *                        `new-record`.
 *   `Someone else…`      pick a record from the cast, or `New character`.
 *   `Not a character`    the cue is nobody. Every candidate and
 *                        `new-record` are rejected together and the row
 *                        leaves the grid for good - open, un-proposed, the
 *                        state the pure core keeps rather than asking again.
 *
 * Every answer writes `resolve_decisions`, re-derives, and the grid
 * re-renders from the pass. The script text is never changed.
 */
export const UnmatchedCard = ({
  projectId,
  row,
  cast,
  run,
}: {
  readonly projectId: ProjectId
  readonly row: ResolveItem
  readonly cast: readonly CastRow[]
  readonly run: Run
}) => {
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const proposal = row.proposal

  const decide = (choice: { readonly kind: 'proposal' } | { readonly kind: 'character'; readonly id: string } | { readonly kind: 'new-record' } | { readonly kind: 'walk-on' }): void => {
    setBusy(true)
    setChoosing(false)
    run(async () => {
      const result = await resolveCue(projectId, row.key, choice)
      setBusy(false)
      return result.status === 'resolved' ? null : result.message
    })
  }

  const where =
    row.scenes.length === 0
      ? 'outside any scene'
      : row.scenes.length <= 3
        ? row.scenes.map(formatSceneRef).join(', ')
        : `${row.scenes.slice(0, 2).map(formatSceneRef).join(', ')} and ${String(row.scenes.length - 2)} more`

  return (
    <article
      data-unmatched-card={row.key}
      data-busy={busy ? 'true' : 'false'}
      className={`flex flex-col gap-[10px] rounded-card border border-dashed border-note bg-note-bg p-[14px] ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-[8px]">
        <span className="h-[6px] w-[6px] flex-none rounded-full bg-note" />
        <span className="text-10 font-semibold uppercase tracking-label text-ink3">In the script, unmatched</span>
      </div>
      <span className="font-mono text-14 text-ink" data-unmatched-cue>
        {row.cue}
      </span>
      <span className="text-11 text-ink2">
        {row.occurrences} {row.occurrences === 1 ? 'cue' : 'cues'} · {where}
      </span>

      <div className="mt-auto flex flex-col gap-[6px]">
        {proposal !== null && !choosing ? (
          <button
            type="button"
            disabled={busy}
            data-unmatched-match
            onClick={() => {
              decide({ kind: 'proposal' })
            }}
            className="flex items-center justify-center gap-[8px] rounded-chrome border-none bg-ink px-[10px] py-[7px] text-11-5 font-semibold text-desk hover:opacity-90 disabled:opacity-50"
          >
            {proposal.kind === 'character' ? (
              <>
                This is <CharacterChip name={proposal.name} hue={proposal.hue} size={16} /> {proposal.name}
              </>
            ) : (
              'Make a new character'
            )}
            <span className="text-9-5 font-normal opacity-70">{proposal.confidence}</span>
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
            className="rounded-chrome border border-line2 bg-sheet px-[8px] py-[6px] text-11-5 text-ink outline-none"
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
          <div className="grid grid-cols-2 gap-[6px]">
            <button
              type="button"
              disabled={busy}
              data-unmatched-other
              onClick={() => {
                setChoosing(true)
              }}
              className={SMALL}
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
              className={SMALL}
            >
              Not a character
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

const SMALL =
  'rounded-chrome border border-line2 bg-transparent px-[8px] py-[6px] text-11 text-ink2 hover:bg-hover hover:text-ink disabled:opacity-50'
