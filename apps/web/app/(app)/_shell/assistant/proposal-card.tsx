'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import { applyProposal, finishEditorApply, readProposalCard, rejectProposal, undoRun } from '../../../../lib/agent/actions'
import type { ApplyOutcome, EditorReport, UndoOutcome } from '../../../../lib/agent/apply'
import { editorFor } from '../../../../lib/agent/editor-channel'
import type { ProposalCard as Card, ProposalCardOp } from '../../../../lib/agent/card'
import { hrefOfTarget } from '../../../../lib/agent/navigate'
import { asRoute } from '../../../../lib/routes'
import { DiffHunks } from './diff-hunks'

/**
 * One proposal in the panel (roadmap task 3.3, ADR 0003 **D1**).
 *
 * What it shows: the summary; each operation in plain language (code's words,
 * from its executor); a record change as before and after; a script or
 * outline change as hunks; whether an operation can be undone, said before it
 * is applied; and where it stands - waiting, applied, partly applied, failed,
 * out of date, rejected.
 *
 * What it does: **Apply**, **Reject**, **Open** (the place the first change
 * lands), and once applied **Undo run** - every change the run made, newest
 * first, with anything changed since offered back as a new proposal rather
 * than overwritten. A proposal holding a `confirm` or `paid` operation opens a
 * confirmation step first: the reason, the cost and the balance it comes out
 * of. No autonomy setting skips that step (D1).
 *
 * Under `auto` the panel mounts a card with `auto` set, and the card applies
 * itself once on first read - unless it asks for confirmation, when it waits
 * like any other.
 */

const STATUS_LABEL: Readonly<Record<Card['status'], string>> = {
  pending: 'waiting for you',
  applied: 'applied',
  partially_applied: 'partly applied',
  failed: 'failed',
  stale: 'out of date',
  rejected: 'rejected',
}

const STATUS_TONE: Readonly<Record<Card['status'], string>> = {
  pending: 'bg-accent',
  applied: 'bg-ok',
  partially_applied: 'bg-warn',
  failed: 'bg-live',
  stale: 'bg-warn',
  rejected: 'bg-ink3',
}

const OP_TONE: Readonly<Record<ProposalCardOp['status'], string>> = {
  pending: 'bg-ink3',
  applied: 'bg-ok',
  failed: 'bg-live',
  skipped: 'bg-line',
  undone: 'bg-ink3',
}

const credits = (count: number): string => `${String(count)} ${count === 1 ? 'credit' : 'credits'}`

const undoSentence = (outcome: Exclude<UndoOutcome, { readonly status: 'refused' }>): string => {
  const parts: string[] = []
  parts.push(outcome.undone === 0 ? 'Nothing was put back.' : `Put back ${String(outcome.undone)} ${outcome.undone === 1 ? 'change' : 'changes'}.`)
  if (outcome.skipped.length > 0) parts.push(`${String(outcome.skipped.length)} could not be undone: ${outcome.skipped.map((skip) => skip.description).join('; ')}.`)
  if (outcome.proposal !== null) parts.push('Some of it changed since the run, so putting it back is a new proposal below.')
  if (outcome.failure !== null) parts.push(`Stopped at ${outcome.failure.tool}: ${outcome.failure.message}`)
  return parts.join(' ')
}

export const ProposalCard = ({
  projectId,
  proposalId,
  auto = false,
}: {
  readonly projectId: string
  readonly proposalId: string
  /** The writer's autonomy is `auto` and the proposal arrived in this turn: apply it on first read. */
  readonly auto?: boolean
}) => {
  const router = useRouter()
  const [card, setCard] = useState<Card | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<'apply' | 'undo' | null>(null)
  const [undone, setUndone] = useState<{ readonly sentence: string; readonly proposal: string | null } | null>(null)
  const autoTried = useRef(false)

  const load = useCallback(async (): Promise<Card | null> => {
    const result = await readProposalCard(projectId, proposalId)
    if (result.status !== 'ok') {
      setNotice(result.message)
      return null
    }
    setCard(result.card)
    return result.card
  }, [projectId, proposalId])

  const cardRef = useRef<Card | null>(null)
  cardRef.current = card

  const apply = useCallback(
    async (confirmed: boolean) => {
      setBusy(true)
      setNotice(null)
      try {
        // D10 path A: a document the writer has open is edited by its editor.
        // What is typed is saved first, so the proposal is checked against it.
        const open = (cardRef.current?.documents ?? []).filter((id) => editorFor(id) !== undefined)
        for (const id of open) await editorFor(id)?.flush()
        let outcome: ApplyOutcome = await applyProposal(projectId, proposalId, confirmed, open)
        if (outcome.status === 'editor') {
          const reports: EditorReport[] = outcome.edits.map((edit) => {
            const handle = editorFor(edit.documentId)
            if (handle === undefined) return { opId: edit.opId, ok: false, message: 'The editor closed before the edit landed.' }
            const done = handle.apply(edit.ops, edit.runId)
            return done.ok ? { opId: edit.opId, ok: true } : { opId: edit.opId, ok: false, message: done.message, stale: done.stale }
          })
          outcome = await finishEditorApply(projectId, proposalId, reports)
        }
        if (outcome.status === 'needs-confirmation') {
          setConfirming('apply')
          return
        }
        setConfirming(null)
        if (outcome.status === 'refused' || outcome.status === 'decided' || outcome.status === 'editor') {
          if (outcome.status !== 'editor') setNotice(outcome.message)
          await load()
          return
        }
        if (outcome.failure !== null) setNotice(outcome.failure)
        await load()
        router.refresh()
      } finally {
        setBusy(false)
      }
    },
    [load, projectId, proposalId, router],
  )

  // The first read, and under `auto` the one apply it may make. `apply` is
  // read through a ref so the effect re-runs only when the proposal changes.
  const applyRef = useRef(apply)
  applyRef.current = apply
  const autoRef = useRef(auto)
  autoRef.current = auto
  useEffect(() => {
    void load().then((read) => {
      if (read === null || !autoRef.current || autoTried.current) return
      autoTried.current = true
      if (read.status === 'pending' && !read.needsConfirmation) void applyRef.current(false)
    })
  }, [load])

  const reject = async (): Promise<void> => {
    setBusy(true)
    const outcome = await rejectProposal(projectId, proposalId)
    if (outcome.status !== 'rejected') setNotice(outcome.message)
    await load()
    setBusy(false)
  }

  const undo = async (): Promise<void> => {
    if (card === null) return
    setBusy(true)
    setConfirming(null)
    try {
      const outcome = await undoRun(projectId, card.runId)
      if (outcome.status === 'refused') {
        setNotice(outcome.message)
        return
      }
      setUndone({ sentence: undoSentence(outcome), proposal: outcome.proposal?.proposal.id ?? null })
      await load()
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (card === null) {
    return (
      <div data-proposal-card data-proposal-status="loading" className="rounded-[12px] border border-line2 bg-s1 px-[12px] py-[10px] text-12 text-ink3">
        {notice ?? 'Reading the proposal…'}
      </div>
    )
  }

  const open = card.ops.find((op) => op.open !== null)?.open ?? null
  const pending = card.status === 'pending'
  const landed = card.status === 'applied' || card.status === 'partially_applied'

  return (
    <div data-proposal-card data-proposal-status={card.status} className="flex flex-col gap-[8px] rounded-[12px] border border-line bg-s1 px-[12px] py-[10px] whitespace-normal">
      <span className="flex items-center gap-[8px]">
        <span className="folio-cite">proposal</span>
        <span aria-hidden="true" className={`h-[6px] w-[6px] flex-none rounded-full ${STATUS_TONE[card.status]}`} />
        <span data-proposal-state className="text-11 text-ink3">
          {STATUS_LABEL[card.status]}
        </span>
      </span>
      <span data-proposal-summary className="text-13 leading-[1.5] text-ink">
        {card.summary}
      </span>

      <ol className="m-0 flex list-none flex-col gap-[8px] p-0">
        {card.ops.map((op) => (
          <li key={op.id} data-proposal-op={op.status} data-proposal-tool={op.tool} className="flex flex-col gap-[5px]">
            <span className="flex items-start gap-[7px] text-12-5 leading-[1.5] text-read">
              <span aria-hidden="true" className={`mt-[7px] h-[5px] w-[5px] flex-none rounded-full ${OP_TONE[op.status]}`} />
              <span className="min-w-0 flex-1">
                {op.description}
                {op.status === 'undone' ? <span className="text-ink3"> · undone</span> : null}
                {op.status === 'skipped' ? <span className="text-ink3"> · not run</span> : null}
                {op.reversible || op.status === 'failed' || op.status === 'skipped' ? null : (
                  <span data-proposal-irreversible className="text-ink3">
                    {' '}
                    · can’t be undone
                  </span>
                )}
              </span>
            </span>
            {op.failure === null ? null : <span className="pl-[12px] text-12 text-live">{op.failure}</span>}
            {op.changes.length === 0 ? null : (
              <dl data-proposal-changes className="m-0 grid grid-cols-[auto_1fr] gap-x-[10px] gap-y-[3px] pl-[12px] text-12">
                {op.changes.map((change) => (
                  <div key={change.field} className="contents">
                    <dt className="text-ink3">{change.field}</dt>
                    <dd className="m-0 min-w-0 break-words">
                      <span className="text-live line-through">{change.before ?? '—'}</span>
                      <span className="text-ink3"> → </span>
                      <span className="text-ok">{change.after ?? '—'}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {op.diff === null ? null : (
              <div className="pl-[12px]">
                <DiffHunks view={op.diff} />
              </div>
            )}
          </li>
        ))}
      </ol>

      {confirming === 'apply' ? (
        <div data-proposal-confirm className="flex flex-col gap-[6px] rounded-[8px] border border-line bg-sunk px-[10px] py-[8px] text-12 leading-[1.5]">
          <span className="text-ink">This asks first because it will:</span>
          <ul className="m-0 flex list-none flex-col gap-[2px] p-0 text-read">
            {card.confirmReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <span data-proposal-cost className="text-ink2">
            {card.creditCost === null || card.creditCost === 0 ? 'Costs no credits.' : `Costs ${credits(card.creditCost)}.`}
            {card.balance === null ? '' : ` You have ${credits(card.balance)} available.`}
          </span>
          <span className="flex gap-[6px]">
            <button
              type="button"
              data-proposal-confirm-yes
              disabled={busy || (card.creditCost !== null && card.balance !== null && card.creditCost > card.balance)}
              onClick={() => {
                void apply(true)
              }}
              className="folio-solid-button rounded-[8px] px-[10px] py-[4px] text-12"
            >
              Confirm
            </button>
            <button type="button" onClick={() => setConfirming(null)} className="folio-ghost-button rounded-[8px] px-[10px] py-[4px] text-12 text-ink2">
              Cancel
            </button>
          </span>
        </div>
      ) : null}

      {confirming === 'undo' ? (
        <div data-proposal-undo-confirm className="flex flex-col gap-[6px] rounded-[8px] border border-line bg-sunk px-[10px] py-[8px] text-12 leading-[1.5]">
          <span className="text-ink">Undo everything this run changed? What can’t be undone stays as it is, and anything edited since is offered back as a new proposal.</span>
          <span className="flex gap-[6px]">
            <button
              type="button"
              data-proposal-undo-yes
              disabled={busy}
              onClick={() => {
                void undo()
              }}
              className="folio-solid-button rounded-[8px] px-[10px] py-[4px] text-12"
            >
              Undo run
            </button>
            <button type="button" onClick={() => setConfirming(null)} className="folio-ghost-button rounded-[8px] px-[10px] py-[4px] text-12 text-ink2">
              Cancel
            </button>
          </span>
        </div>
      ) : null}

      {notice === null ? null : (
        <span role="status" className="text-12 text-live">
          {notice}
        </span>
      )}
      {undone === null ? null : (
        <span data-proposal-undone className="text-12 leading-[1.5] text-ink2">
          {undone.sentence}
        </span>
      )}

      <span className="flex flex-wrap items-center gap-[6px]">
        {pending && confirming === null ? (
          <>
            <button
              type="button"
              data-proposal-apply
              disabled={busy}
              onClick={() => {
                if (card.needsConfirmation) setConfirming('apply')
                else void apply(false)
              }}
              className="folio-solid-button rounded-[8px] px-[10px] py-[4px] text-12"
            >
              {card.needsConfirmation ? 'Review and apply' : 'Apply'}
            </button>
            <button
              type="button"
              data-proposal-reject
              disabled={busy}
              onClick={() => {
                void reject()
              }}
              className="folio-ghost-button rounded-[8px] px-[10px] py-[4px] text-12 text-ink2"
            >
              Reject
            </button>
          </>
        ) : null}
        {open === null ? null : (
          <button
            type="button"
            data-proposal-open
            onClick={() => {
              router.push(asRoute(hrefOfTarget(open)))
            }}
            className="folio-ghost-button rounded-[8px] px-[10px] py-[4px] text-12 text-ink2"
          >
            Open
          </button>
        )}
        {landed && confirming === null ? (
          <button
            type="button"
            data-proposal-undo
            disabled={busy}
            onClick={() => setConfirming('undo')}
            className="folio-ghost-button rounded-[8px] px-[10px] py-[4px] text-12 text-ink2"
          >
            Undo run
          </button>
        ) : null}
      </span>

      {undone?.proposal === null || undone === null ? null : <ProposalCard projectId={projectId} proposalId={undone.proposal} />}
    </div>
  )
}
