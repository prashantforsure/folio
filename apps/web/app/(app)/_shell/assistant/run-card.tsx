'use client'

import type { AgentRunStatus } from '@folio/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { approveBackgroundRunAction, cancelBackgroundRunAction, readBackgroundRunView } from '../../../../lib/agent/actions'
import type { RunView } from '../../../../lib/agent/runs'
import { useLivePoll } from './use-live-poll'

/**
 * A background run in the panel (roadmap task 4.4, ADR 0003 **D7**).
 *
 * Mounted under the answer that started it, and above the composer of the
 * run's own chat. It reads the run once, then every two seconds while it is
 * `queued` or `running` (`useLivePoll`) - never pushed, as D7 rules - and
 * stops polling the moment it is not. It shows where the run is, how many
 * steps it has taken, what it has proposed and what waits on the writer; its
 * buttons are **Approve** (at a checkpoint - a story's or a production run's - the starter's; the only way
 * one moves on; an empty reply does nothing), **Open** (the run's chat, where
 * its work and its proposals are) and **Cancel**, the starter's or an owner's.
 *
 * `run` seeds it when the caller already read the run (the run's own chat
 * does, on every poll), so the card draws at once and does not poll twice.
 */

const STATUS_LABEL: Readonly<Record<AgentRunStatus, string>> = {
  queued: 'queued',
  running: 'working',
  waiting_for_user: 'waiting for you',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
}

const STATUS_TONE: Readonly<Record<AgentRunStatus, string>> = {
  queued: 'bg-ink3',
  running: 'bg-accent',
  waiting_for_user: 'bg-warn',
  succeeded: 'bg-ok',
  failed: 'bg-live',
  cancelled: 'bg-ink3',
}

const plural = (count: number, one: string, many: string = `${one}s`): string => `${String(count)} ${count === 1 ? one : many}`

export const isLiveRun = (status: AgentRunStatus): boolean => status === 'queued' || status === 'running'

/** The card's one line of figures: `working · 7 steps · 2 proposals to review`. */
export const runLine = (run: RunView): string => {
  const parts = [STATUS_LABEL[run.status]]
  if (run.status === 'queued') parts.push('waiting for the worker')
  else parts.push(plural(run.steps, 'step'))
  if (run.proposals.toConfirm > 0) parts.push(`${plural(run.proposals.toConfirm, 'proposal')} to confirm`)
  else if (run.proposals.pending > 0) parts.push(`${plural(run.proposals.pending, 'proposal')} to review`)
  if (run.proposals.applied > 0) parts.push(`${String(run.proposals.applied)} applied`)
  return parts.join(' · ')
}

export const RunCard = ({
  projectId,
  runId,
  title,
  run: seeded = null,
  onOpen,
  onChange,
}: {
  readonly projectId: string
  readonly runId: string
  readonly title: string
  /** The run as the caller last read it; the card polls for itself only without one. */
  readonly run?: RunView | null
  /** Open the run's own chat. Absent in that chat, where the card sits above the composer. */
  readonly onOpen?: (chatId: string) => void
  /** The run as the card's own reads or its Cancel left it. */
  readonly onChange?: (run: RunView) => void
}) => {
  const [own, setOwn] = useState<RunView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = seeded ?? own
  // The latest callback, without making every render a new read.
  const changed = useRef(onChange)
  changed.current = onChange

  const read = useCallback(async () => {
    const result = await readBackgroundRunView(projectId, runId)
    if (result.status !== 'ok') {
      setNotice(result.message)
      return
    }
    setOwn(result.run)
    changed.current?.(result.run)
  }, [projectId, runId])

  useEffect(() => {
    if (seeded === null) void read()
  }, [read, seeded])
  // The caller polls a seeded card's run; an unseeded one polls itself while live.
  useLivePoll(seeded === null && run !== null && isLiveRun(run.status), read)

  const runAction = async (action: typeof cancelBackgroundRunAction): Promise<void> => {
    setBusy(true)
    setNotice(null)
    const result = await action(projectId, runId)
    setBusy(false)
    if (result.status !== 'ok') {
      setNotice(result.message)
      return
    }
    setOwn(result.run)
    changed.current?.(result.run)
  }

  const stoppable = run !== null && (isLiveRun(run.status) || run.status === 'waiting_for_user')
  const approvable = run !== null && run.status === 'waiting_for_user' && run.mine && run.checkpoint !== null
  return (
    <div data-run-card data-run-status={run?.status ?? 'loading'} className="flex flex-col gap-[6px] whitespace-normal rounded-[12px] border border-line bg-s1 px-[12px] py-[10px]">
      <span className="flex items-center gap-[8px]">
        <span className="folio-cite">background run</span>
        <span aria-hidden="true" className={`h-[6px] w-[6px] flex-none rounded-full ${run === null ? 'bg-ink3' : STATUS_TONE[run.status]} ${run !== null && isLiveRun(run.status) ? 'animate-pulse' : ''}`} />
        <span data-run-line className="min-w-0 truncate text-11 text-ink3">
          {run === null ? 'reading…' : runLine(run)}
        </span>
      </span>
      <span data-run-title className="text-13 leading-[1.5] text-ink">
        {title}
      </span>
      {run?.note == null ? null : (
        <span data-run-note className={`text-12 leading-[1.5] ${run.status === 'failed' ? 'text-live' : 'text-ink2'}`}>
          {run.note}
        </span>
      )}
      {notice === null ? null : (
        <span role="status" className="text-12 text-live">
          {notice}
        </span>
      )}
      {(onOpen === undefined || run?.chatId == null) && !stoppable ? null : (
        <span className="flex gap-[6px]">
          {approvable ? (
            <button
              type="button"
              data-run-approve
              disabled={busy}
              onClick={() => {
                void runAction(approveBackgroundRunAction)
              }}
              className="folio-solid-button rounded-[8px] px-[10px] py-[4px] text-12"
            >
              Approve
            </button>
          ) : null}
          {onOpen === undefined || run?.chatId == null ? null : (
            <button
              type="button"
              data-run-open
              onClick={() => {
                if (run.chatId !== null) onOpen(run.chatId)
              }}
              className="folio-ghost-button rounded-[8px] border border-line2 px-[10px] py-[4px] text-12 text-ink"
            >
              {run.status === 'waiting_for_user' && run.mine ? 'Open to reply' : 'Open'}
            </button>
          )}
          {stoppable ? (
            <button
              type="button"
              data-run-cancel
              disabled={busy}
              onClick={() => {
                void runAction(cancelBackgroundRunAction)
              }}
              className="folio-ghost-button rounded-[8px] px-[10px] py-[4px] text-12 text-ink2"
            >
              Cancel run
            </button>
          ) : null}
        </span>
      )}
    </div>
  )
}
