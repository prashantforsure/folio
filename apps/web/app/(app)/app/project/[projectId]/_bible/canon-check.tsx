'use client'

import type { CanonConflictRow, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useState } from 'react'

import { decideConflict } from '../../../../../../lib/bible/actions'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import { bibleEntryHref } from '../../../../../../lib/workspace/hrefs'
import type { Run } from './bible-workspace'

/**
 * The canon check: every canon rule read against the current draft.
 * `Route - Bible.dc.html`, `isCheck`: the sentence, then one card per open
 * conflict - the entry's name over the rule in 16px Newsreader, the two
 * lines side by side (`Established · E1 Sc 3` on `--sheet`, `Contradicts ·
 * E3 Sc 8` on `--note-bg`, both in Courier), and the three decisions -
 * then the green line: "N other rules hold across all K episodes."
 *
 * A conflict here is one the writer (or, later, the agent's canon
 * pre-flight) recorded on a canon entry, whose scene is still in the
 * draft. Nothing here reads a model: "a report never calls a model", and a
 * contradiction is a judgement, so the judgement is recorded and this
 * view is where it is decided. `Scene is right · update rule` opens the
 * rule in place and saves the rewrite; `Rule is right · flag scene` leaves
 * a comment thread on the scene's heading; `Both fine` decides it and
 * nothing else changes.
 *
 * With no canon rule at all the view says so rather than reporting that
 * zero rules hold: a draft is not checked, and promoting one is the way in.
 */
export const CanonCheck = ({
  projectId,
  conflicts,
  canonFacts,
  episodes,
  run,
}: {
  readonly projectId: ProjectId
  readonly conflicts: readonly CanonConflictRow[]
  readonly canonFacts: number
  readonly episodes: number
  readonly run: Run
}) => {
  const holding = Math.max(0, canonFacts - conflicts.length)
  const span = episodes === 1 ? 'the episode' : `all ${String(episodes)} episodes`

  return (
    <div className="min-w-0 flex-1 overflow-auto px-[22px] pb-[60px] pt-[20px]" data-canon-check data-open-conflicts={conflicts.length}>
      <div className="flex max-w-[820px] flex-col gap-[14px]">
        <p className="m-0 max-w-[70ch] text-11-5 leading-[1.5] text-ink2">
          Every canon rule read against the current draft. A conflict means a scene says something the rule forbids.
          Decide which one is right.
        </p>

        {conflicts.map((row) => (
          <ConflictCard key={row.factId} projectId={projectId} row={row} run={run} />
        ))}

        {canonFacts === 0 ? (
          <div
            data-no-canon
            className="flex items-center gap-[10px] rounded-chrome border border-line2 bg-panel px-[14px] py-[10px] text-11-5 text-ink2"
          >
            <span className="h-[6px] w-[6px] rounded-full bg-line" />
            No canon rules yet. Promote an entry to canon and its rules are read against every draft.
          </div>
        ) : (
          <div
            data-rules-holding
            className="flex items-center gap-[10px] rounded-chrome border border-line2 bg-add-bg px-[14px] py-[10px] text-11-5"
          >
            <span className="h-[6px] w-[6px] rounded-full bg-add" />
            {holding} other {holding === 1 ? 'rule holds' : 'rules hold'} across {span}.
          </div>
        )}
      </div>
    </div>
  )
}

const ConflictCard = ({
  projectId,
  row,
  run,
}: {
  readonly projectId: ProjectId
  readonly row: CanonConflictRow
  readonly run: Run
}) => {
  const [rewriting, setRewriting] = useState(false)
  const [text, setText] = useState(row.rule)

  const decide = (decision: { readonly choice: 'rule' } | { readonly choice: 'both' } | { readonly choice: 'scene'; readonly text: string }): void => {
    run(async () => {
      const result = await decideConflict(projectId, row.factId, decision)
      return result.status === 'decided' ? null : result.message
    })
  }

  return (
    <div data-conflict={row.factId} className="flex flex-col gap-[10px] rounded-chrome border border-line bg-panel px-[15px] py-[13px]">
      <div className="flex items-start gap-[10px]">
        <span className="mt-[4px] h-[7px] w-[7px] flex-none rounded-full bg-note" />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <Link
            href={bibleEntryHref(projectId, row.entryId)}
            className="text-9-5 font-semibold uppercase tracking-label text-ink3 no-underline hover:text-ink hover:no-underline"
          >
            {row.entryTitle}
          </Link>
          {rewriting ? (
            <textarea
              autoFocus
              value={text}
              onChange={(event) => {
                setText(event.target.value)
              }}
              rows={2}
              aria-label="The rule, updated"
              className="w-full rounded-chrome border border-accent-line bg-sheet px-[6px] py-[4px] font-serif text-16 leading-[1.35] text-ink outline-none"
            />
          ) : (
            <span className="font-serif text-16 leading-[1.35]" style={{ textWrap: 'pretty' }}>
              {row.rule}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[8px] pl-[17px]">
        <div className="flex flex-col gap-[3px] rounded-chrome border border-line2 bg-sheet px-[10px] py-[8px]">
          <span className="text-10 text-ink3">
            Established · {row.established === null ? '—' : formatSceneRef(row.established.scene)}
          </span>
          <span className="font-mono text-11 leading-[1.5] text-ink2">
            {row.established === null
              ? 'This rule cites no scene yet.'
              : row.established.excerpt === ''
                ? row.established.scene.heading
                : row.established.excerpt}
          </span>
        </div>
        <div className="flex flex-col gap-[3px] rounded-chrome border border-note bg-note-bg px-[10px] py-[8px]">
          <span className="text-10 text-note">Contradicts · {formatSceneRef(row.contradicts.scene)}</span>
          <span className="font-mono text-11 leading-[1.5] text-ink">
            {row.contradicts.excerpt === '' ? row.contradicts.scene.heading : row.contradicts.excerpt}
          </span>
          <span className="text-10-5 leading-[1.5] text-ink2">{row.contradicts.note}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-[6px] pl-[17px]">
        {rewriting ? (
          <>
            <button
              type="button"
              onClick={() => {
                const next = text.trim()
                if (next === '') return
                setRewriting(false)
                decide({ choice: 'scene', text: next })
              }}
              data-decide-scene-save
              className="rounded-chrome border-none bg-ink px-[11px] py-[5px] text-11 font-semibold text-desk hover:opacity-90"
            >
              Save the rule
            </button>
            <button
              type="button"
              onClick={() => {
                setRewriting(false)
                setText(row.rule)
              }}
              className="rounded-chrome border border-line2 bg-transparent px-[11px] py-[5px] text-11 text-ink3 hover:bg-hover hover:text-ink"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                decide({ choice: 'rule' })
              }}
              data-decide-rule
              className="rounded-chrome border-none bg-ink px-[11px] py-[5px] text-11 font-semibold text-desk hover:opacity-90"
            >
              Rule is right · flag scene
            </button>
            <button
              type="button"
              onClick={() => {
                setRewriting(true)
              }}
              data-decide-scene
              className="rounded-chrome border border-line bg-transparent px-[11px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink"
            >
              Scene is right · update rule
            </button>
            <button
              type="button"
              onClick={() => {
                decide({ choice: 'both' })
              }}
              data-decide-both
              className="rounded-chrome border border-line2 bg-transparent px-[11px] py-[5px] text-11 text-ink3 hover:bg-hover hover:text-ink"
            >
              Both fine
            </button>
          </>
        )}
      </div>
    </div>
  )
}
