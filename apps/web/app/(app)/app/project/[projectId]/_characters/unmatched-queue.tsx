'use client'

import type { PairItem, ProjectId, ResolveCandidate, ResolveItem } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { decidePair, previewRename, renameCharacter, resolveCue } from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import { QUEUE_FOLD, reasonLabel, unmatchedLabel } from '../../../../../../lib/characters/cast'
import { setQueueIntent, useQueueIntent } from '../../../../../../lib/characters/compose'
import { citeOf } from '../../../../../../lib/characters/figures'
import type { RenamePreview } from '../../../../../../lib/characters/result'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import type { Run } from '../_chrome/use-run'
import { useDismiss } from '../_chrome/use-dismiss'
import { RenameConfirm } from './rename-confirm'

/**
 * The resolve queue at the head of the Cast view: the names in the script
 * that point at no record, one row per open cue (AGENTS.md: "rows, not a
 * computed view"). Drawn whenever there are rows and never dismissed - a
 * decision waiting is not a notice; past five rows it folds to the first
 * five with `Show all N`. Each row: the cue in mono, how many, *why* the
 * app is asking (the reason chip - `first name`, `contains MEERA`, `2
 * letters off`), its citations as links into the script, and the decision:
 *
 *   `This is <name>` / `Maybe <name>`   take the row's own proposal - solid
 *                                       when the pass is certain or likely,
 *                                       a line button when it is a guess
 *   `New character`                     the proposal, when nothing resembles it
 *   `Someone else…`                     a menu: the records this cue resembles
 *                                       first, then the cast, then a new one
 *   `Not a character`                   the cue is nobody; listed as a walk-on
 *   `or rename <Name> → <CUE>`          under a record proposal: the record
 *                                       takes this spelling everywhere - the
 *                                       sanctioned write-back behind its confirm
 *
 * Every answer writes `resolve_decisions`, re-derives, and the grid
 * re-renders from the pass; the status bar says what happened with an
 * `Undo` for a few seconds. The script text is never changed except by the
 * rename, which says so first. A cue whose proposal names a record is also
 * that record's conflict block on its card; either door decides the same row.
 *
 * ## Two records, one person
 *
 * Under the cue rows, a row per pair of records that read as one person
 * (`similarRecords` - a record made by hand under the full name beside the
 * one the pass minted from the first name): `MEERA PAWAR reads like Meera -
 * two records.`, the two scene counts, the confidence, `Merge into <keep>`
 * (solid; the drawer's merge) and `They're different people` (a rejection
 * under the pair's key, so the pair is never listed again). The header's
 * second line counts them. Not undoable from the toast: a merge is the
 * drawer's own irreversible act and says so there.
 */
export type QueueDecision =
  | { readonly kind: 'walk-on' }
  | { readonly kind: 'not-this'; readonly id: string; readonly name: string }
  | { readonly kind: 'bound'; readonly id: string; readonly name: string }
  | { readonly kind: 'new-record' }

export const UnmatchedQueue = ({
  projectId,
  shape,
  resolve,
  pairs,
  cast,
  run,
  toast,
  onDecided,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly resolve: readonly ResolveItem[]
  readonly pairs: readonly PairItem[]
  readonly cast: readonly CastFigure[]
  readonly run: Run
  readonly toast: (message: string) => void
  /** After a decision lands: the toast, with its undo. */
  readonly onDecided: (item: ResolveItem, decision: QueueDecision) => void
}) => {
  const [expanded, setExpanded] = useState(false)
  const intent = useQueueIntent()
  useEffect(() => {
    if (intent !== 'rows') return
    setExpanded(true)
    setQueueIntent(null)
  }, [intent])
  const folded = resolve.length > QUEUE_FOLD && !expanded
  const rows = folded ? resolve.slice(0, QUEUE_FOLD) : resolve
  return (
    <section data-unmatched-banner data-open={folded ? 'false' : 'true'} className="flex flex-col rounded-card border border-line2 bg-s1">
      <div className="flex items-center gap-[12px] px-[14px] py-[10px]">
        <span className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
        <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="text-12-5 text-ink2" data-unmatched-count={resolve.length}>
            {resolve.length === 0 ? 'Every name in the script matches a character' : unmatchedLabel(resolve.length)}
          </span>
          {pairs.length === 0 ? null : (
            <span className="text-11 text-ink3" data-pairs-count={pairs.length}>
              {pairs.length === 1 ? '2 records may be one person' : `${String(pairs.length)} pairs of records may be one person`}
            </span>
          )}
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
      {rows.length === 0 ? null : (
        <ul className="m-0 flex list-none flex-col border-t border-line2 p-0">
          {rows.map((item) => (
            <QueueRow key={item.key} projectId={projectId} shape={shape} item={item} cast={cast} run={run} onDecided={onDecided} />
          ))}
        </ul>
      )}
      {pairs.length === 0 ? null : (
        <ul className="m-0 flex list-none flex-col border-t border-line2 p-0">
          {pairs.map((pair) => (
            <PairRow key={pair.key} projectId={projectId} pair={pair} run={run} toast={toast} />
          ))}
        </ul>
      )}
    </section>
  )
}

const PairRow = ({
  projectId,
  pair,
  run,
  toast,
}: {
  readonly projectId: ProjectId
  readonly pair: PairItem
  readonly run: Run
  readonly toast: (message: string) => void
}) => {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const decide = (verdict: 'merge' | 'different'): void => {
    setBusy(true)
    run(async () => {
      const result = await decidePair(projectId, pair.keep.id, pair.other.id, verdict)
      setBusy(false)
      if (result.status === 'merged') {
        toast(`Merged ${pair.other.name} into ${pair.keep.name}.`)
        router.push(characterHref(projectId, result.into))
        return null
      }
      if (result.status === 'different') {
        toast(`${pair.other.name} and ${pair.keep.name} are different people.`)
        return null
      }
      return result.message
    })
  }
  return (
    <li data-pair-row={pair.key} data-busy={busy ? 'true' : 'false'} className={`flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-line2 px-[14px] py-[10px] last:border-b-0 ${busy ? 'opacity-60' : ''}`}>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-12-5 text-ink">
          <span className="font-mono">{pair.other.name.toUpperCase()}</span> reads like {pair.keep.name} - two records.
        </span>
        <span className="tabular text-11 text-ink3">
          {pair.other.appearances} {pair.other.appearances === 1 ? 'scene' : 'scenes'} · {pair.keep.appearances} {pair.keep.appearances === 1 ? 'scene' : 'scenes'} ·{' '}
          <span className="folio-cite" data-pair-confidence={pair.confidence}>
            {pair.confidence}
          </span>
        </span>
      </span>
      <span className="flex flex-none flex-wrap items-center gap-[6px]">
        <button
          type="button"
          disabled={busy}
          data-pair-merge
          onClick={() => {
            decide('merge')
          }}
          className="folio-solid-button h-[28px] rounded-[8px] px-[12px] text-12 font-medium"
        >
          Merge into {pair.keep.name}
        </button>
        <button
          type="button"
          disabled={busy}
          data-pair-different
          onClick={() => {
            decide('different')
          }}
          className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
        >
          They're different people
        </button>
      </span>
    </li>
  )
}

type Choice =
  | { readonly kind: 'proposal' }
  | { readonly kind: 'character'; readonly id: string }
  | { readonly kind: 'new-record' }
  | { readonly kind: 'walk-on' }

const CandidateItem = ({ candidate, onPick }: { readonly candidate: ResolveCandidate; readonly onPick: () => void }) => (
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
  cast,
  run,
  onDecided,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly item: ResolveItem
  readonly cast: readonly CastFigure[]
  readonly run: Run
  readonly onDecided: (item: ResolveItem, decision: QueueDecision) => void
}) => {
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [preview, setPreview] = useState<RenamePreview | null>(null)
  const menuRoot = useRef<HTMLDivElement>(null)
  useDismiss(menu, () => setMenu(false), menuRoot)
  const proposal = item.proposal
  const record = proposal?.kind === 'character' ? proposal : null
  const candidateIds = new Set(item.candidates.map((candidate) => candidate.id))
  const rest = cast.filter((figure) => !candidateIds.has(figure.id))

  const decide = (choice: Choice, decision: QueueDecision): void => {
    setBusy(true)
    setMenu(false)
    run(async () => {
      const result = await resolveCue(projectId, item.key, choice)
      setBusy(false)
      if (result.status !== 'resolved') return result.message
      onDecided(item, decision)
      return null
    })
  }

  const openRename = (): void => {
    if (record === null) return
    setRenaming(true)
    setPreview(null)
    void previewRename(projectId, record.id, item.cue).then(setPreview)
  }

  const rename = (): void => {
    if (record === null) return
    setBusy(true)
    run(async () => {
      const result = await renameCharacter(projectId, record.id, item.cue)
      setBusy(false)
      if (result.status === 'renamed') {
        setRenaming(false)
        return null
      }
      return result.status === 'taken' ? `${result.cue} is already ${result.name}'s cue.` : result.message
    })
  }

  return (
    <li
      data-unmatched-row={item.cue}
      data-unmatched-key={item.key}
      data-busy={busy ? 'true' : 'false'}
      className={`flex flex-col gap-[8px] border-b border-line2 px-[14px] py-[10px] last:border-b-0 ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <span className="flex flex-wrap items-baseline gap-[8px]">
            <span className="font-mono text-12-5 text-ink" data-unmatched-cue>
              {item.cue}
            </span>
            <span className="tabular text-11 text-ink3">
              {item.occurrences} {item.occurrences === 1 ? 'cue' : 'cues'}
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
        {renaming ? null : (
          <span className="flex flex-none flex-wrap items-center gap-[6px]">
            {proposal === null ? null : (
              <button
                type="button"
                disabled={busy}
                data-unmatched-match
                data-confidence={proposal.confidence}
                onClick={() => {
                  decide(
                    { kind: 'proposal' },
                    record === null ? { kind: 'new-record' } : { kind: 'bound', id: record.id, name: record.name },
                  )
                }}
                className={
                  record !== null && proposal.confidence !== 'possible'
                    ? 'folio-solid-button h-[28px] rounded-[8px] px-[12px] text-12 font-medium'
                    : 'folio-line-button h-[28px] rounded-[8px] px-[12px] text-12'
                }
              >
                {record === null ? 'New character' : proposal.confidence === 'possible' ? `Maybe ${record.name}` : `This is ${record.name}`}
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
                Someone else…
              </button>
              {menu ? (
                <div role="menu" aria-label="Who is this" className="folio-menu absolute right-0 top-[32px] z-[3] max-h-[280px] w-[240px] overflow-y-auto">
                  {item.candidates.map((candidate) => (
                    <CandidateItem
                      key={candidate.id}
                      candidate={candidate}
                      onPick={() => {
                        decide({ kind: 'character', id: candidate.id }, { kind: 'bound', id: candidate.id, name: candidate.name })
                      }}
                    />
                  ))}
                  {rest.map((figure, index) => (
                    <button
                      key={figure.id}
                      type="button"
                      role="menuitem"
                      data-unmatched-pick={figure.id}
                      onClick={() => {
                        decide({ kind: 'character', id: figure.id }, { kind: 'bound', id: figure.id, name: figure.name })
                      }}
                      className={`folio-menu-item ${index === 0 && item.candidates.length > 0 ? 'mt-[4px] border-t border-line2 pt-[10px]' : ''}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{figure.name}</span>
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
                    <span className="min-w-0 flex-1">+ New character</span>
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy}
              data-unmatched-walk-on
              onClick={() => {
                decide({ kind: 'walk-on' }, { kind: 'walk-on' })
              }}
              className="folio-line-button h-[28px] rounded-[8px] px-[10px] text-12"
            >
              Not a character
            </button>
          </span>
        )}
      </div>
      {record !== null && !renaming ? (
        <button
          type="button"
          disabled={busy}
          data-unmatched-rename
          onClick={openRename}
          className="self-start text-11 text-ink3 hover:text-ink2 hover:underline"
        >
          or rename {record.name} → {item.cue}
        </button>
      ) : null}
      {renaming && record !== null ? (
        <div className="flex flex-wrap items-center gap-[8px] rounded-[10px] border border-line2 bg-sunk px-[12px] py-[10px]" data-unmatched-rename-confirm>
          <RenameConfirm
            from={record.name}
            to={item.cue}
            preview={preview}
            busy={busy}
            onConfirm={rename}
            onKeep={() => {
              setRenaming(false)
            }}
            onMerge={() => {
              // A rename from the queue never merges: the holder of this spelling is
              // the record the queue is asking about, so the confirm just closes.
              setRenaming(false)
            }}
          />
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setRenaming(false)
            }}
            className="folio-ghost-button grid h-[24px] w-[24px] flex-none place-items-center rounded-[7px] text-ink3"
          >
            <Icon name="close" size={11} strokeWidth={1.5} />
          </button>
        </div>
      ) : null}
    </li>
  )
}
