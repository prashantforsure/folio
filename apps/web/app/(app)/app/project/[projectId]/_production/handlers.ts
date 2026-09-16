import type { ClipSeconds, ProductionShot, ShotEdit } from '@folio/contracts'
import type { LabelBook, MentionLabel } from '@folio/script'

import type { GateInput } from '../../../../../../lib/production/status'

/**
 * What the Scene view can do to a scene's reels, and what it draws them
 * from. The workspace owns the rows and every write; a reel card, a shot
 * row and a frame tile call back. One type so the pieces cannot drift on
 * what a shot or a reel can do.
 *
 * Every write here is `lib/production/actions.ts`'s, except the four the
 * Storyboard already owns and Production reuses unchanged - edit a shot's
 * text, accept a proposal, discard one, cancel a frame
 * (`lib/storyboard/actions.ts`).
 */
export type ProductionHandlers = {
  readonly onAddReel: (sceneNodeId: string) => void
  /** Put the scene's unreeled shots in a reel - the first, or a new one when the scene has none. */
  readonly onPutOrphans: (sceneNodeId: string, reelId: string | null) => void
  /** The empty scene's AI action: a reel, then a proposal for it. */
  readonly onProposeForScene: (sceneNodeId: string) => void
  readonly onRenameReel: (reelId: string, name: string) => void
  readonly onSetClip: (reelId: string, seconds: ClipSeconds) => void
  readonly onMoveReel: (reelId: string, direction: 'up' | 'down') => void
  readonly onRemoveReel: (reelId: string) => void
  readonly onAddShot: (reelId: string, edit: ShotEdit) => void
  readonly onProposeForReel: (reelId: string) => void
  readonly onAccept: (sceneNodeId: string, shotId: string) => void
  /** Discard a proposal, or remove a shot. */
  readonly onDiscard: (sceneNodeId: string, shotId: string) => void
  readonly onSaveShot: (shotId: string, edit: ShotEdit) => void
  readonly onMoveShot: (shotId: string, direction: 'up' | 'down') => void
  readonly onGenerate: (reelId: string) => void
  readonly onFinalize: (reelId: string) => void
  readonly onUnlock: (reelId: string) => void
  readonly onRender: (reelId: string) => void
  readonly onKeep: (sceneNodeId: string, generationId: string) => void
  readonly onCancelJob: (sceneNodeId: string, jobId: string) => void
  /** Open the assistant with the refusal as the question. The assistant answers; the writer edits. */
  readonly onSuggestRewrite: (shot: ProductionShot) => void
}

export type SceneViewProps = {
  readonly labels: readonly MentionLabel[]
  readonly book: LabelBook
  readonly input: GateInput
  /** A write is in flight; every button waits. */
  readonly pending: boolean
  readonly handlers: ProductionHandlers
  /** The reel card's grid, from the viewport: three columns, two, or one. */
  readonly columns: 3 | 2 | 1
}
