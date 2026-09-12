'use client'

import type { LocationRow, ProjectId, SluglineResolveItem, StructureResolveItem } from '@folio/contracts'
import { useState } from 'react'

import { formatSceneRef } from '../../../../../../lib/characters/figures'
import { resolveSlugline, resolveStructure } from '../../../../../../lib/locations/actions'
import type { Run } from './locations-workspace'

/**
 * The resolve queue: sluglines that point at no record, each with a guess
 * and a confidence - and, under them, the tree's proposals.
 *
 * `Route - Locations.dc.html`, `isResolve`: the count as a serif line ("N
 * sluglines don't point at a record"), the paragraph, then one card per
 * set - the set in Courier, where it occurs, `Likely` and the proposal as
 * an accent chip carrying its confidence (`certain` · `likely` ·
 * `possible`), and three buttons:
 *
 *   `Match`        take the proposal: bind the set text to that record, or
 *                  mint a new one when the proposal is `new-record`.
 *   `Other…`       pick a different record from the tree and bind to it.
 *   `New record`   this set is its own place.
 *
 * There is no Walk-on: a heading is always somewhere, so a slugline is
 * never nobody.
 *
 * The second list is what makes the tree: a record whose own name reads
 * like `<head> - <rest>` gets a proposal to hang under `<head>` - an
 * existing record (`attach`), or a primary set the headings imply but
 * nobody has made (`new-parent`). AGENTS.md, Entity identity: the tree is
 * authored, and "derivation only ever proposes an edge". `Attach` writes
 * the edge; `Keep separate` records the rejection, and the pure core never
 * makes that guess again.
 *
 * Every button writes `resolve_decisions`, the authored table, and the
 * re-derive that follows reads it. The script text is never changed - the
 * paragraph says so, and nothing here can.
 */
export const ResolveQueue = ({
  projectId,
  rows,
  structure,
  locations,
  run,
}: {
  readonly projectId: ProjectId
  readonly rows: readonly SluglineResolveItem[]
  readonly structure: readonly StructureResolveItem[]
  /** Tree order, for the `Other…` picker. */
  readonly locations: readonly LocationRow[]
  readonly run: Run
}) => {
  const pending = rows.filter((row) => row.proposal !== null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [other, setOther] = useState<string | null>(null)
  const [choice, setChoice] = useState<string>('')

  const mark = (key: string, on: boolean): void => {
    setBusy((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const decide = (
    key: string,
    decision: { readonly kind: 'proposal' } | { readonly kind: 'location'; readonly id: string } | { readonly kind: 'new-record' },
  ): void => {
    mark(key, true)
    setOther(null)
    run(async () => {
      const result = await resolveSlugline(projectId, key, decision)
      mark(key, false)
      return result.status === 'resolved' ? null : result.message
    })
  }

  const decideStructure = (key: string, decision: 'accept' | 'reject'): void => {
    mark(key, true)
    run(async () => {
      const result = await resolveStructure(projectId, key, { kind: decision })
      mark(key, false)
      return result.status === 'resolved' ? null : result.message
    })
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-[22px] pb-[60px] pt-[20px]" data-resolve-queue>
      <div className="flex max-w-[820px] flex-col gap-[14px]">
        <div className="flex flex-col gap-[4px]">
          <span className="font-serif text-20 font-medium tracking-title" data-resolve-count={pending.length}>
            {pending.length} {pending.length === 1 ? 'slugline doesn’t' : 'sluglines don’t'} point at a record
          </span>
          <p className="m-0 max-w-[70ch] text-11-5 leading-[1.5] text-ink2">
            Usually a typo or a shorter form of a place that exists. Match them and the counts above become accurate.
            The script text is never changed.
          </p>
        </div>

        {pending.length === 0 ? (
          <div className="rounded-chrome border border-line bg-panel px-[14px] py-[12px] text-11-5 text-ink3">
            Every heading in the script points at a record. New sets appear here as you write them.
          </div>
        ) : null}

        {pending.map((row) => {
          const proposal = row.proposal
          const isBusy = busy.has(row.key)
          return (
            <div
              key={row.key}
              data-resolve-row={row.slugline}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[14px] rounded-chrome border border-line bg-panel px-[14px] py-[12px] ${
                isBusy ? 'opacity-50' : ''
              }`}
            >
              <div className="flex min-w-0 flex-col gap-[4px]">
                <span className="font-mono text-12-5">{row.scenes[0]?.heading ?? row.slugline}</span>
                <span className="text-10-5 text-ink3">{summariseScenes(row)}</span>
                {proposal === null ? null : (
                  <div className="mt-[4px] flex items-center gap-[6px]">
                    <span className="text-10-5 text-ink3">Likely</span>
                    <span className="inline-flex items-center gap-[6px] rounded-chrome border border-accent-line bg-accent-bg px-[8px] py-[2px] text-11 text-ink">
                      {proposal.kind === 'location' ? proposal.name : 'New location'}
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
                      decide(row.key, { kind: 'location', id: choice })
                    }}
                    className="mt-[6px] flex items-center gap-[6px]"
                  >
                    <select
                      autoFocus
                      value={choice}
                      onChange={(event) => {
                        setChoice(event.target.value)
                      }}
                      aria-label={`Where ${row.slugline} is`}
                      className="min-w-0 flex-1 rounded-chrome border border-line2 bg-sheet px-[8px] py-[4px] text-11-5 text-ink outline-none"
                    >
                      <option value="">Where is this?</option>
                      {locations.map((record) => (
                        <option key={record.id} value={record.id}>
                          {record.parentId === null ? record.name : `— ${record.name}`}
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
                    decide(row.key, { kind: 'new-record' })
                  }}
                  data-resolve-new-record
                  className="whitespace-nowrap rounded-chrome border border-line2 bg-transparent px-[11px] py-[5px] text-11-5 text-ink3 hover:bg-hover hover:text-ink disabled:opacity-50"
                >
                  New record
                </button>
              </div>
            </div>
          )
        })}

        {structure.length > 0 ? (
          <div className="mt-[10px] flex flex-col gap-[4px]" data-structure-count={structure.length}>
            <span className="font-serif text-20 font-medium tracking-title">
              {structure.length} {structure.length === 1 ? 'set reads' : 'sets read'} like part of a larger one
            </span>
            <p className="m-0 max-w-[70ch] text-11-5 leading-[1.5] text-ink2">
              A heading like <span className="font-mono">KAMATHI CHAWL - CORRIDOR</span> names a place inside a place.
              Attach it and the parent’s counts include it; keep it separate and you won’t be asked again.
            </p>
          </div>
        ) : null}

        {structure.map((row) => {
          const isBusy = busy.has(row.key)
          return (
            <div
              key={row.key}
              data-structure-row={row.location.name}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[14px] rounded-chrome border border-line bg-panel px-[14px] py-[12px] ${
                isBusy ? 'opacity-50' : ''
              }`}
            >
              <div className="flex min-w-0 flex-col gap-[4px]">
                <span className="font-mono text-12-5">{row.location.name}</span>
                <span className="text-10-5 text-ink3">
                  {row.scenes} {row.scenes === 1 ? 'scene' : 'scenes'}
                </span>
                <div className="mt-[4px] flex items-center gap-[6px]">
                  <span className="text-10-5 text-ink3">{row.proposal.kind === 'attach' ? 'Inside' : 'Inside a new set'}</span>
                  <span className="inline-flex items-center gap-[6px] rounded-chrome border border-accent-line bg-accent-bg px-[8px] py-[2px] text-11 text-ink">
                    {row.proposal.kind === 'attach' ? row.proposal.parent.name : row.proposal.name}
                    <span className="text-9-5 text-ink3" data-confidence={row.proposal.confidence}>
                      {row.proposal.confidence}
                    </span>
                  </span>
                </div>
              </div>
              <div className="flex gap-[6px]">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    decideStructure(row.key, 'accept')
                  }}
                  data-structure-attach
                  className="whitespace-nowrap rounded-chrome border-none bg-ink px-[11px] py-[5px] text-11-5 font-semibold text-desk hover:opacity-90 disabled:opacity-50"
                >
                  {row.proposal.kind === 'attach' ? 'Attach' : 'Create and attach'}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    decideStructure(row.key, 'reject')
                  }}
                  data-structure-keep
                  className="whitespace-nowrap rounded-chrome border border-line2 bg-transparent px-[11px] py-[5px] text-11-5 text-ink3 hover:bg-hover hover:text-ink disabled:opacity-50"
                >
                  Keep separate
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** `E2 Sc 11, E3 Sc 4 · 2 scenes`; up to three scenes named. */
const summariseScenes = (row: SluglineResolveItem): string => {
  const scenes = row.scenes.slice(0, 3).map(formatSceneRef)
  const more = row.scenes.length - scenes.length
  const places = scenes.length === 0 ? 'no present scene' : scenes.join(', ') + (more > 0 ? ` +${String(more)}` : '')
  return `${places} · ${String(row.occurrences)} ${row.occurrences === 1 ? 'heading' : 'headings'}`
}
