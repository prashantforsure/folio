'use client'

import type { LocationRow, ProjectId, SluglineCandidate, SluglineResolveItem } from '@folio/contracts'
import { useEffect, useRef, useState } from 'react'

import { reasonLabel } from '../../../../../../lib/characters/cast'
import { citeOf } from '../../../../../../lib/characters/figures'
import { resolveSlugline, revokeDecision } from '../../../../../../lib/locations/actions'
import { setQueueIntent, useQueueIntent } from '../../../../../../lib/locations/compose'
import { QUEUE_FOLD, decisionToast, unmatchedLabel } from '../../../../../../lib/locations/view'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import type { StatusToast } from '../_chrome/status-bar'
import { useDismiss } from '../_chrome/use-dismiss'
import type { Run } from '../_chrome/use-run'

/**
 * The resolve queue at the head of the Places view: the sluglines in the
 * script that point at no record, one row per open set text (AGENTS.md:
 * "rows, not a computed view"). Drawn whenever there are rows and never
 * dismissed - a decision waiting is not a notice; past five rows it folds
 * to the first five with `Show all N`. Each row: the set text in mono, how
 * many headings, *why* the app is asking (the reason chip - `starts the
 * same`, `contains CHAWL`, `2 letters off`), its citations as links into
 * the script, and the decision:
 *
 *   `This is <name>` / `Maybe <name>`   take the row's own proposal - solid
 *                                       when the pass is certain or likely,
 *                                       a line button when it is a guess
 *   `New location`                      the proposal, when nothing resembles it
 *   `Somewhere else…`                   a menu: the records this set text
 *                                       resembles first, with their reasons,
 *                                       then every record in tree order,
 *                                       then a new one
 *
 * There is no "not a location" here as there is "not a character" for a
 * cue: a scene heading always names a place. Every answer writes
 * `resolve_decisions`, re-derives, and the grid re-renders from the pass;
 * the status bar says what happened with an `Undo` for a few seconds
 * (`revokeDecision`). The script text is never changed.
 */
export const UnmatchedQueue = ({
  projectId,
  shape,
  resolve,
  rows,
  run,
  toast,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly resolve: readonly SluglineResolveItem[]
  readonly rows: readonly LocationRow[]
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
}) => {
  const [expanded, setExpanded] = useState(false)
  const intent = useQueueIntent()
  useEffect(() => {
    if (intent !== 'rows') return
    setExpanded(true)
    setQueueIntent(null)
  }, [intent])
  const folded = resolve.length > QUEUE_FOLD && !expanded
  const shown = folded ? resolve.slice(0, QUEUE_FOLD) : resolve
  return (
    <section data-unmatched-banner data-open={folded ? 'false' : 'true'} className="flex flex-col rounded-card border border-line2 bg-s1">
      <div className="flex items-center gap-[12px] px-[14px] py-[10px]">
        <span className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
        <span className="min-w-0 flex-1 text-12-5 text-ink2" data-unmatched-count={resolve.length}>
          {unmatchedLabel(resolve.length)}
        </span>
        {resolve.length > QUEUE_FOLD ? (
          <button
            type="button"
            data-unmatched-review
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((value) => !value)
            }}
            className="folio-line-button h-[28px] flex-none rounded-[8px] px-[12px] text-12"
          >
            {expanded ? 'Show fewer' : `Show all ${String(resolve.length)}`}
          </button>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col border-t border-line2 p-0">
        {shown.map((item) => (
          <QueueRow key={item.key} projectId={projectId} shape={shape} item={item} rows={rows} run={run} toast={toast} />
        ))}
      </ul>
    </section>
  )
}

type Choice = { readonly kind: 'proposal' } | { readonly kind: 'location'; readonly id: string } | { readonly kind: 'new-record' }

type Decision = { readonly kind: 'bound'; readonly id: string; readonly name: string } | { readonly kind: 'new-record' }

const CandidateItem = ({ candidate, onPick }: { readonly candidate: SluglineCandidate; readonly onPick: () => void }) => (
  <button type="button" role="menuitem" data-unmatched-pick={candidate.id} onClick={onPick} className="folio-menu-item">
    <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
    <span className="folio-cite flex-none" data-unmatched-pick-reason>
      {reasonLabel(candidate.reason)}
    </span>
  </button>
)

const QueueRow = ({
  projectId,
  shape,
  item,
  rows,
  run,
  toast,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly item: SluglineResolveItem
  readonly rows: readonly LocationRow[]
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
}) => {
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRoot = useRef<HTMLDivElement>(null)
  useDismiss(menu, () => setMenu(false), menuRoot)
  const proposal = item.proposal
  const record = proposal?.kind === 'location' ? proposal : null
  const candidateIds = new Set(item.candidates.map((candidate) => candidate.id))
  const rest = rows.filter((row) => !candidateIds.has(row.id))

  const undo = (decision: Decision): void => {
    run(async () => {
      const result = await revokeDecision(projectId, item.key, decision.kind === 'bound' ? { kind: 'bound', id: decision.id } : { kind: 'new-record' })
      if (result.status !== 'resolved') return result.message
      toast(`${item.slugline} is back in the queue.`)
      return null
    })
  }

  const decide = (choice: Choice, decision: Decision): void => {
    setBusy(true)
    setMenu(false)
    run(async () => {
      const result = await resolveSlugline(projectId, item.key, choice)
      setBusy(false)
      if (result.status !== 'resolved') return result.message
      toast(decisionToast(item.slugline, decision), {
        label: 'Undo',
        onClick: () => {
          undo(decision)
        },
      })
      return null
    })
  }

  return (
    <li
      data-unmatched-row={item.slugline}
      data-unmatched-key={item.key}
      data-busy={busy ? 'true' : 'false'}
      className={`flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-line2 px-[14px] py-[10px] last:border-b-0 ${busy ? 'opacity-60' : ''}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <span className="flex flex-wrap items-baseline gap-[8px]">
          <span className="font-mono text-12-5 uppercase text-ink" data-unmatched-slugline>
            {item.slugline}
          </span>
          <span className="tabular text-11 text-ink3">
            {item.occurrences} {item.occurrences === 1 ? 'heading' : 'headings'}
          </span>
          {record !== null && record.reason !== null ? (
            <span className="folio-cite" data-unmatched-reason>
              {reasonLabel(record.reason)}
            </span>
          ) : proposal?.kind === 'new-record' ? (
            <span className="folio-cite" data-unmatched-reason>
              nothing resembles it
            </span>
          ) : null}
        </span>
        <CitationChips refs={item.scenes.map((ref) => citeOf(projectId, shape, ref))} />
      </span>
      <span className="flex flex-none flex-wrap items-center gap-[6px]">
        {proposal === null ? null : (
          <button
            type="button"
            disabled={busy}
            data-unmatched-match
            data-confidence={proposal.confidence}
            onClick={() => {
              decide({ kind: 'proposal' }, record === null ? { kind: 'new-record' } : { kind: 'bound', id: record.id, name: record.name })
            }}
            className={
              record !== null && proposal.confidence !== 'possible'
                ? 'folio-solid-button h-[28px] rounded-[8px] px-[12px] text-12 font-medium'
                : 'folio-line-button h-[28px] rounded-[8px] px-[12px] text-12'
            }
          >
            {record === null ? 'New location' : proposal.confidence === 'possible' ? `Maybe ${record.name}` : `This is ${record.name}`}
          </button>
        )}
        <div ref={menuRoot} className="relative">
          <button
            type="button"
            disabled={busy}
            data-unmatched-other
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => {
              setMenu((open) => !open)
            }}
            className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
          >
            Somewhere else…
          </button>
          {menu ? (
            <div role="menu" aria-label="Where is this" className="folio-menu absolute right-0 top-[32px] z-[3] max-h-[280px] w-[260px] overflow-y-auto">
              {item.candidates.map((candidate) => (
                <CandidateItem
                  key={candidate.id}
                  candidate={candidate}
                  onPick={() => {
                    decide({ kind: 'location', id: candidate.id }, { kind: 'bound', id: candidate.id, name: candidate.name })
                  }}
                />
              ))}
              {rest.map((row, at) => (
                <button
                  key={row.id}
                  type="button"
                  role="menuitem"
                  data-unmatched-pick={row.id}
                  onClick={() => {
                    decide({ kind: 'location', id: row.id }, { kind: 'bound', id: row.id, name: row.name })
                  }}
                  className={`folio-menu-item ${at === 0 && item.candidates.length > 0 ? 'mt-[4px] border-t border-line2 pt-[10px]' : ''}`}
                  style={row.depth > 0 ? { paddingLeft: 12 + row.depth * 12 } : undefined}
                >
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                data-unmatched-pick="new-record"
                onClick={() => {
                  decide({ kind: 'new-record' }, { kind: 'new-record' })
                }}
                className={`folio-menu-item ${item.candidates.length + rest.length > 0 ? 'mt-[4px] border-t border-line2 pt-[10px]' : ''}`}
              >
                <span className="min-w-0 flex-1">+ New location</span>
              </button>
            </div>
          ) : null}
        </div>
      </span>
    </li>
  )
}
