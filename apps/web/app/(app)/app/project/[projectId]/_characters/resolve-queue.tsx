'use client'

import type { CastRow, ProjectId, ResolveItem } from '@folio/contracts'
import { useState } from 'react'

import { resolveCue } from '../../../../../../lib/characters/actions'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import type { Run } from './characters-workspace'
import { CharacterChip } from './chip'

/**
 * The resolve queue: cues that point at no record, each with a proposal.
 *
 * `Route - Characters.dc.html`, `isResolve`: the count as a serif line
 * ("N character cues don't point at a record"), the paragraph, then one
 * card per cue - the cue in Courier, where it occurs, `Likely` and the
 * proposal as an accent chip carrying its confidence (`certain` · `likely`
 * · `possible`), and three buttons:
 *
 *   `Match`    take the proposal: bind the spelling to that record, or
 *              mint a new one when the proposal is `new-record`.
 *   `Other…`   pick a different record from the cast and bind to it, or
 *              make a new record.
 *   `Walk-on`  this cue is nobody. Every candidate and `new-record` are
 *              rejected together, and the row leaves the queue for good -
 *              it stays open with no proposal, which is the state the pure
 *              core keeps rather than asking again.
 *
 * AGENTS.md, Entity identity: "The resolve queue is rows, not a computed
 * view." Every button here writes `resolve_decisions`, the authored table,
 * and the re-derive that follows reads it. The script text is never
 * changed - the paragraph says so, and nothing here can.
 *
 * The rows are the server's read; a decision re-derives, the action
 * revalidates, and the list re-renders from the pass. A row being decided
 * is greyed until then.
 */
export const ResolveQueue = ({
  projectId,
  rows,
  cast,
  run,
}: {
  readonly projectId: ProjectId
  readonly rows: readonly ResolveItem[]
  readonly cast: readonly CastRow[]
  readonly run: Run
}) => {
  const pending = rows.filter((row) => row.proposal !== null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [other, setOther] = useState<string | null>(null)
  const [choice, setChoice] = useState<string>('')

  const decide = (
    key: string,
    decision:
      | { readonly kind: 'proposal' }
      | { readonly kind: 'character'; readonly id: string }
      | { readonly kind: 'new-record' }
      | { readonly kind: 'walk-on' },
  ): void => {
    setBusy((current) => new Set([...current, key]))
    setOther(null)
    run(async () => {
      const result = await resolveCue(projectId, key, decision)
      setBusy((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
      return result.status === 'resolved' ? null : result.message
    })
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-[22px] pb-[60px] pt-[20px]" data-resolve-queue>
      <div className="flex max-w-[820px] flex-col gap-[14px]">
        <div className="flex flex-col gap-[4px]">
          <span className="font-serif text-20 font-medium tracking-title" data-resolve-count={pending.length}>
            {pending.length} character {pending.length === 1 ? 'cue doesn’t' : 'cues don’t'} point at a record
          </span>
          <p className="m-0 max-w-[70ch] text-11-5 leading-[1.5] text-ink2">
            Usually a typo, a nickname, or a walk-on who doesn’t need a record. Match them and Presence and Production
            stay accurate. The script text is never changed.
          </p>
        </div>

        {pending.length === 0 ? (
          <div className="rounded-chrome border border-line bg-panel px-[14px] py-[12px] text-11-5 text-ink3">
            Every cue in the script points at a record. New spellings appear here as you write them.
          </div>
        ) : null}

        {pending.map((row) => {
          const proposal = row.proposal
          const where = summariseScenes(row)
          const isBusy = busy.has(row.key)
          return (
            <div
              key={row.key}
              data-resolve-row={row.cue}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[14px] rounded-chrome border border-line bg-panel px-[14px] py-[12px] ${
                isBusy ? 'opacity-50' : ''
              }`}
            >
              <div className="flex min-w-0 flex-col gap-[4px]">
                <span className="font-mono text-12-5">{row.cue}</span>
                <span className="text-10-5 text-ink3">{where}</span>
                {proposal === null ? null : (
                  <div className="mt-[4px] flex items-center gap-[6px]">
                    <span className="text-10-5 text-ink3">Likely</span>
                    <span className="inline-flex items-center gap-[6px] rounded-chrome border border-accent-line bg-accent-bg px-[8px] py-[2px] text-11 text-ink">
                      {proposal.kind === 'character' ? (
                        <>
                          <CharacterChip name={proposal.name} hue={proposal.hue} size={14} />
                          {proposal.name}
                        </>
                      ) : (
                        'New character'
                      )}
                      <span className="text-9-5 text-ink3" data-confidence={proposal.confidence}>
                        {proposal.confidence}
                      </span>
                    </span>
                  </div>
                )}
                {other === row.key ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (choice === '') return
                      decide(row.key, choice === 'new-record' ? { kind: 'new-record' } : { kind: 'character', id: choice })
                    }}
                    className="mt-[6px] flex items-center gap-[6px]"
                  >
                    <select
                      autoFocus
                      value={choice}
                      onChange={(event) => {
                        setChoice(event.target.value)
                      }}
                      aria-label={`Who ${row.cue} is`}
                      className="min-w-0 flex-1 rounded-chrome border border-line2 bg-sheet px-[8px] py-[4px] text-11-5 text-ink outline-none"
                    >
                      <option value="">Who is this?</option>
                      <option value="new-record">A new character</option>
                      {cast.map((record) => (
                        <option key={record.id} value={record.id}>
                          {record.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={choice === ''}
                      data-resolve-other-confirm
                      className="rounded-chrome border-none bg-ink px-[11px] py-[5px] text-11-5 font-semibold text-desk disabled:opacity-50"
                    >
                      Match
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOther(null)
                      }}
                      className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11-5 text-ink2 hover:bg-hover"
                    >
                      Cancel
                    </button>
                  </form>
                ) : null}
              </div>
              <div className="flex gap-[6px]">
                <button
                  type="button"
                  disabled={isBusy || proposal === null}
                  onClick={() => {
                    decide(row.key, { kind: 'proposal' })
                  }}
                  data-resolve-match
                  className="whitespace-nowrap rounded-chrome border-none bg-ink px-[11px] py-[5px] text-11-5 font-semibold text-desk hover:opacity-90 disabled:opacity-50"
                >
                  Match
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setChoice('')
                    setOther(other === row.key ? null : row.key)
                  }}
                  data-resolve-other
                  className="whitespace-nowrap rounded-chrome border border-line bg-transparent px-[11px] py-[5px] text-11-5 text-ink2 hover:bg-hover hover:text-ink disabled:opacity-50"
                >
                  Other…
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    decide(row.key, { kind: 'walk-on' })
                  }}
                  data-resolve-walk-on
                  className="whitespace-nowrap rounded-chrome border border-line2 bg-transparent px-[11px] py-[5px] text-11-5 text-ink3 hover:bg-hover hover:text-ink disabled:opacity-50"
                >
                  Walk-on
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** `E3 Sc 30 · 2 cues`, or `E1 Sc 3, E2 Sc 3 · 4 cues`; up to three scenes named. */
const summariseScenes = (row: ResolveItem): string => {
  const scenes = row.scenes.slice(0, 3).map(formatSceneRef)
  const more = row.scenes.length - scenes.length
  const places = scenes.length === 0 ? 'outside any scene' : scenes.join(', ') + (more > 0 ? ` +${String(more)}` : '')
  return `${places} · ${String(row.occurrences)} ${row.occurrences === 1 ? 'cue' : 'cues'}`
}
