'use client'

import type { AgentOpStatus, AgentProposalStatus, AgentRunStatus, EpisodeSlug, ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { readRunHistory, undoRun } from '../../../../lib/agent/actions'
import type { HistoryRun } from '../../../../lib/agent/history'
import { hrefOfTarget } from '../../../../lib/agent/navigate'
import { relativeTime } from '../../../../lib/format/relative-time'
import { asRoute } from '../../../../lib/routes'
import { thousands } from '../../../../lib/workspace/format'
import { undoSentence } from './proposal-card'

/**
 * The panel's History tab - roadmap task 5.4, ADR 0003 **D11**. Every run of
 * the project, newest first: what it was (a turn, a background task, a
 * pipeline), where it stands, the tokens it used and the credits it was
 * granted and spent, and under it each proposal with its operations - each in
 * code's words, with where it stands, when it was undone, and an **Open** to
 * what it changed. **Undo run** is offered while the run has something that
 * can be put back, and says what it did, in the proposal card's words.
 *
 * Read once when the tab opens and again on `Refresh` or after an undo - not
 * polled: a live run polls on its own card, and this is the record.
 */

const RUN_LABEL: Readonly<Record<AgentRunStatus, string>> = {
  queued: 'queued',
  running: 'working',
  waiting_for_user: 'waiting for you',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
}

const RUN_TONE: Readonly<Record<AgentRunStatus, string>> = {
  queued: 'bg-ink3',
  running: 'bg-accent',
  waiting_for_user: 'bg-warn',
  succeeded: 'bg-ok',
  failed: 'bg-live',
  cancelled: 'bg-ink3',
}

const KIND_LABEL: Readonly<Record<HistoryRun['kind'], string>> = {
  turn: 'turn',
  task: 'background run',
  story_to_script: 'story to script',
  script_to_production: 'to production',
}

const PROPOSAL_LABEL: Readonly<Record<AgentProposalStatus, string>> = {
  pending: 'waiting for you',
  applied: 'applied',
  partially_applied: 'partly applied',
  failed: 'failed',
  stale: 'out of date',
  rejected: 'rejected',
}

const OP_LABEL: Readonly<Record<AgentOpStatus, string>> = {
  pending: 'waiting',
  applied: 'applied',
  failed: 'failed',
  skipped: 'skipped',
  undone: 'undone',
}

/** `12.3k tokens` - the D3 meter, rounded for reading. */
const tokensLine = (run: HistoryRun): string => {
  const total = run.tokens.input + run.tokens.output
  if (total === 0) return 'no tokens'
  return total < 1_000 ? `${String(total)} tokens` : `${(total / 1_000).toFixed(1)}k tokens`
}

/** `40 of 415 credits` spent of what was confirmed; `no credits` for a run that was granted none. */
const creditsLine = (run: HistoryRun): string =>
  run.credits.budget === 0 ? 'no credits' : `${thousands(run.credits.spent)} of ${thousands(run.credits.budget)} credits`

export const RunHistory = ({
  projectId,
  onOpenChat,
}: {
  readonly projectId: ProjectId
  /** Open a run's chat in the panel, in the episode it ran in. */
  readonly onOpenChat: (chatId: string, episode: EpisodeSlug | null) => void
}) => {
  const router = useRouter()
  const [runs, setRuns] = useState<readonly HistoryRun[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<Readonly<Record<string, string>>>({})

  const load = useCallback(async (): Promise<void> => {
    const result = await readRunHistory(projectId)
    if (result.status !== 'ok') {
      setNotice(result.message)
      return
    }
    setNotice(null)
    setRuns(result.runs)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const undo = async (run: HistoryRun): Promise<void> => {
    setBusy(run.id)
    try {
      const outcome = await undoRun(projectId, run.id)
      setSaid((current) => ({ ...current, [run.id]: outcome.status === 'refused' ? outcome.message : undoSentence(outcome) }))
      await load()
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const now = new Date()
  return (
    <div data-run-history className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[16px] py-[14px]">
      <span className="flex items-center gap-[8px]">
        <span className="text-12 text-ink3">{runs === null ? 'Reading the runs…' : `${String(runs.length)} ${runs.length === 1 ? 'run' : 'runs'}, newest first`}</span>
        <span className="flex-1" />
        <button type="button" data-history-refresh onClick={() => void load()} className="folio-ghost-button rounded-[8px] px-[8px] py-[3px] text-12 text-ink2">
          Refresh
        </button>
      </span>
      {notice === null ? null : (
        <p role="status" className="m-0 text-12 text-live">
          {notice}
        </p>
      )}
      {runs !== null && runs.length === 0 ? (
        <p data-history-empty className="m-0 text-13 leading-[1.55] text-ink2">
          No runs yet. Everything the assistant does in this project is listed here: what it proposed, what you applied, and what it cost.
        </p>
      ) : null}
      {(runs ?? []).map((run) => (
        <article key={run.id} data-history-run={run.id} data-history-status={run.status} className="flex flex-col gap-[6px] rounded-[12px] border border-line bg-s1 px-[12px] py-[10px]">
          <span className="flex items-center gap-[8px]">
            <span className="folio-cite">{KIND_LABEL[run.kind]}</span>
            <span aria-hidden="true" className={`h-[6px] w-[6px] flex-none rounded-full ${RUN_TONE[run.status]}`} />
            <span className="min-w-0 truncate text-11 text-ink3">
              {RUN_LABEL[run.status]} · {relativeTime(run.createdAt, now)}
            </span>
          </span>
          <span data-history-title className="text-13 leading-[1.5] text-ink">
            {run.title}
          </span>
          <span data-history-figures className="font-mono text-11 text-ink3">
            {tokensLine(run)} · {creditsLine(run)}
          </span>
          {run.note === null ? null : <span className={`text-12 leading-[1.5] ${run.status === 'failed' ? 'text-live' : 'text-ink2'}`}>{run.note}</span>}

          {run.proposals.length === 0 ? null : (
            <ol className="m-0 flex list-none flex-col gap-[8px] p-0">
              {run.proposals.map((proposal) => (
                <li key={proposal.id} data-history-proposal={proposal.status} className="flex flex-col gap-[4px] border-t border-line2 pt-[6px]">
                  <span className="flex items-center gap-[6px] text-11 text-ink3">
                    <span>proposal · {PROPOSAL_LABEL[proposal.status]}</span>
                    {proposal.creditCost === null ? null : <span>· {thousands(proposal.creditCost)} credits</span>}
                  </span>
                  <ol className="m-0 flex list-none flex-col gap-[3px] p-0">
                    {proposal.ops.map((op) => (
                      <li key={op.id} data-history-op={op.status} data-history-tool={op.tool} className="flex items-start gap-[6px] text-12 leading-[1.5] text-read">
                        <span className="min-w-0 flex-1">
                          {op.description}
                          <span className="text-ink3"> · {op.undoneAt === null ? OP_LABEL[op.status] : `undone ${relativeTime(op.undoneAt, now)}`}</span>
                        </span>
                        {op.open === null ? null : (
                          <button
                            type="button"
                            data-history-open
                            onClick={() => {
                              if (op.open !== null) router.push(asRoute(hrefOfTarget(op.open)))
                            }}
                            className="folio-ghost-button flex-none rounded-[6px] px-[6px] py-[1px] text-11 text-accent"
                          >
                            Open
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}

          {said[run.id] === undefined ? null : (
            <span role="status" data-history-undone className="text-12 leading-[1.5] text-ink2">
              {said[run.id]}
            </span>
          )}
          {run.chatId === null && !run.undoable ? null : (
            <span className="flex gap-[6px]">
              {run.chatId === null ? null : (
                <button
                  type="button"
                  data-history-chat
                  onClick={() => {
                    if (run.chatId !== null) onOpenChat(run.chatId, run.episode)
                  }}
                  className="folio-ghost-button rounded-[8px] border border-line2 px-[10px] py-[4px] text-12 text-ink"
                >
                  Open chat
                </button>
              )}
              {run.undoable ? (
                <button
                  type="button"
                  data-history-undo
                  disabled={busy !== null}
                  onClick={() => void undo(run)}
                  className="folio-ghost-button rounded-[8px] border border-line2 px-[10px] py-[4px] text-12 text-ink"
                >
                  {busy === run.id ? 'Undoing…' : 'Undo run'}
                </button>
              ) : null}
            </span>
          )}
        </article>
      ))}
    </div>
  )
}
