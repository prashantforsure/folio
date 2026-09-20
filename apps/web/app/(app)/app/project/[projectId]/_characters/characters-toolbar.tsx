'use client'

import { memo } from 'react'

import { setNewCharacterOpen } from '../../../../../../lib/characters/compose'
import { NewButton, RecordToolbar } from '../_chrome/record-toolbar'

/**
 * The Characters toolbar row (the fourth pass, 2026-09-20), on the record
 * routes' shared pieces (`_chrome/record-toolbar.tsx`): the route name,
 * the count chip, `flex: 1`, then the `Needs a decision · N` pill and the
 * solid `＋ New character`. The view pill is the header's centre
 * (`view-state.tsx`); the route has no sidebar (ruling 2), so what the
 * sidebar's widget used to count sits here.
 *
 * The pill is the one door to the identity layer's machinery - the
 * resolve queue's cue rows, its pair rows and the walk-ons, re-homed in
 * the `Needs a decision` panel (`queue-panel.tsx`) - and is drawn only
 * while there is a decision to take: a count that has reached zero is not
 * a notice. A warn dot marks it, the rail's badge tone. The count is the
 * queue's rows plus its pairs, as the rail badge counts them.
 */
export const CharactersToolbar = memo(
  ({
    count,
    decisions,
    queueOpen,
    onQueue,
  }: {
    /** The count chip: `8`. */
    readonly count: number
    /** Open cue rows with a proposal plus pair rows: what the panel lists. */
    readonly decisions: number
    readonly queueOpen: boolean
    readonly onQueue: () => void
  }) => (
    <RecordToolbar title="Characters" total={count} countAttr="data-cast-count" attr="data-characters-toolbar">
      {decisions === 0 ? null : (
        <button
          type="button"
          data-decision-pill={decisions}
          aria-pressed={queueOpen}
          title="Names in the script that need a decision"
          onClick={onQueue}
          className="folio-pill-button flex h-[34px] items-center gap-[8px] whitespace-nowrap rounded-[10px] px-[13px] text-12-5 aria-pressed:bg-s2"
        >
          <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
          Needs a decision
          <span className="tabular text-ink3">· {decisions}</span>
        </button>
      )}
      <NewButton
        attr="data-new-character"
        label="＋ New character"
        onClick={() => {
          setNewCharacterOpen(true)
        }}
      />
    </RecordToolbar>
  ),
)
CharactersToolbar.displayName = 'CharactersToolbar'
