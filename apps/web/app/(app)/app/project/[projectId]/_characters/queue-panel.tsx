'use client'

import type { PairItem, ProjectId, ResolveItem } from '@folio/contracts'
import { useCallback } from 'react'

import { revokeDecision } from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { DrawerShell } from './drawer-shell'
import type { QueueDecision } from './unmatched-queue'
import { UnmatchedQueue } from './unmatched-queue'
import { WalkOnsLine } from './walk-ons-line'

/**
 * `Needs a decision` - the identity layer's machinery, off the main
 * surface (the fourth pass, 2026-09-20): the resolve queue's cue rows and
 * pair rows (`unmatched-queue.tsx`, unchanged - rows, never a computed
 * view) and the walk-ons line (`walk-ons-line.tsx`), in the drawer slot
 * behind the toolbar's `Needs a decision · N` pill. The canvas is the
 * surface; this is a pill away. The Scenes modal's link still opens it
 * (`setQueueIntent`, read by the workspace).
 *
 * Every queue decision lands in the status bar as a sentence with `Undo`
 * for a few seconds (`revokeDecision` takes it back), so a mis-click is
 * never permanent - the handler that used to live on the Cast view.
 */
const decided = (item: ResolveItem, decision: QueueDecision): { readonly message: string; readonly undo: unknown } => {
  switch (decision.kind) {
    case 'walk-on':
      return { message: `${item.cue} is not a character.`, undo: { kind: 'walk-on' } }
    case 'not-this':
      return { message: `${item.cue} is not ${decision.name}.`, undo: { kind: 'not-this', id: decision.id } }
    case 'bound':
      return { message: `${item.cue} is ${decision.name}'s now.`, undo: { kind: 'bound', id: decision.id } }
    case 'new-record':
      return { message: `${item.cue} is a new character.`, undo: { kind: 'new-record' } }
  }
}

export const QueuePanel = ({
  projectId,
  shape,
  figures,
  resolve,
  pairs,
  walkOns,
  run,
  toast,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  /** Every record - the queue's cast. */
  readonly figures: readonly CastFigure[]
  readonly resolve: readonly ResolveItem[]
  readonly pairs: readonly PairItem[]
  readonly walkOns: readonly ResolveItem[]
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
  readonly onClose: () => void
}) => {
  const undo = useCallback(
    (item: ResolveItem, decision: unknown): void => {
      run(async () => {
        const result = await revokeDecision(projectId, item.key, decision)
        if (result.status !== 'resolved') return result.message
        toast('Undone.', undefined)
        return null
      })
    },
    [projectId, run, toast],
  )
  const onDecided = (item: ResolveItem, decision: QueueDecision): void => {
    const { message, undo: choice } = decided(item, decision)
    toast(message, {
      label: 'Undo',
      onClick: () => {
        undo(item, choice)
      },
    })
  }
  const total = resolve.length + pairs.length

  return (
    <DrawerShell
      title="Needs a decision"
      meta={
        <span className="tabular" data-queue-count={total}>
          {total} {total === 1 ? 'decision' : 'decisions'}
          {walkOns.length === 0 ? '' : ` · ${String(walkOns.length)} ${walkOns.length === 1 ? 'walk-on' : 'walk-ons'}`}
        </span>
      }
      label="Needs a decision"
      onClose={onClose}
      footer={
        <>
          <span className="min-w-0 flex-1 text-11 text-ink3">Every answer can be taken back from the status bar for a few seconds.</span>
          <button type="button" data-queue-done onClick={onClose} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
            Done
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-[14px]" data-queue-panel>
        {total === 0 ? (
          <span className="text-12 text-ink3" data-queue-empty>
            Nothing needs a decision. Every name in the script points at a character.
          </span>
        ) : (
          <UnmatchedQueue projectId={projectId} shape={shape} resolve={resolve} pairs={pairs} cast={figures} run={run} toast={toast} onDecided={onDecided} />
        )}
        {walkOns.length > 0 ? (
          <WalkOnsLine
            projectId={projectId}
            shape={shape}
            walkOns={walkOns}
            run={run}
            onRevoked={(item) => {
              toast(`${item.cue} is back in the queue.`)
            }}
          />
        ) : null}
      </div>
    </DrawerShell>
  )
}
