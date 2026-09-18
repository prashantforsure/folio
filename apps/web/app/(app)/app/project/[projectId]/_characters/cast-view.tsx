'use client'

import type { PairItem, ProjectId, ResolveItem, SceneFacts } from '@folio/contracts'

import { revokeDecision } from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { CharacterCard } from './character-card'
import type { QueueDecision } from './unmatched-queue'
import { UnmatchedQueue } from './unmatched-queue'
import { WalkOnsLine } from './walk-ons-line'

/**
 * The Cast view: the queue first while it has rows or pairs
 * (`unmatched-queue.tsx`, never dismissed), the walk-ons line under it
 * (`walk-ons-line.tsx`), then the grid of content-first cards
 * (`repeat(auto-fill, minmax(260px, 1fr))`, 14px gaps). `0 20px 24px`
 * around it all. The toolbar's filter narrows the cards and never the
 * queue; an empty filter is one line with `Show all`.
 *
 * Every queue decision lands in the status bar as a sentence with `Undo`
 * for a few seconds (`revokeDecision` takes it back), so a mis-click is
 * never permanent.
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

export const CastView = ({
  projectId,
  shape,
  figures,
  shown,
  index,
  resolve,
  pairs,
  walkOns,
  selectedId,
  storage,
  run,
  toast,
  onShowAll,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  /** Every record - the queue's cast. */
  readonly figures: readonly CastFigure[]
  /** The records after the toolbar's filter - the grid. */
  readonly shown: readonly CastFigure[]
  readonly index: readonly SceneFacts[]
  readonly resolve: readonly ResolveItem[]
  readonly pairs: readonly PairItem[]
  readonly walkOns: readonly ResolveItem[]
  readonly selectedId: string | null
  readonly storage: boolean
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
  readonly onShowAll: () => void
}) => {
  const undo = (item: ResolveItem, decision: unknown): void => {
    run(async () => {
      const result = await revokeDecision(projectId, item.key, decision)
      if (result.status !== 'resolved') return result.message
      toast('Undone.', undefined)
      return null
    })
  }
  const onDecided = (item: ResolveItem, decision: QueueDecision): void => {
    const { message, undo: choice } = decided(item, decision)
    toast(message, {
      label: 'Undo',
      onClick: () => {
        undo(item, choice)
      },
    })
  }

  return (
    <div data-cast-view className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
      <div className="flex flex-col gap-[14px]">
        {resolve.length > 0 || pairs.length > 0 ? (
          <UnmatchedQueue projectId={projectId} shape={shape} resolve={resolve} pairs={pairs} cast={figures} run={run} toast={toast} onDecided={onDecided} />
        ) : null}
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

        {shown.length === 0 && figures.length > 0 ? (
          <p className="m-0 text-12-5 text-ink3" data-cast-filtered-empty>
            No character matches that filter.{' '}
            <button type="button" data-show-all onClick={onShowAll} className="text-accent hover:underline">
              Show all
            </button>
          </p>
        ) : (
          <div data-cast-grid className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {shown.map((figure) => (
              <CharacterCard
                key={figure.id}
                projectId={projectId}
                shape={shape}
                figure={figure}
                index={index}
                selected={figure.id === selectedId}
                storage={storage}
                run={run}
                onDecided={onDecided}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
