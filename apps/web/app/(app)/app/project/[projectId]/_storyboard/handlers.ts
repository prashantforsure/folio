import type { ShotEdit, ShotRow, StoryboardScene } from '@folio/contracts'
import type { LabelBook, MentionLabel } from '@folio/script'

import type { DisplayOptions } from './storyboard-toolbar'

/**
 * What the three views can do to the board, and what they draw it from.
 * The workspace owns the rows and every write; a view is a layout over
 * `ViewProps` that calls back. One type for all three so the board, the
 * canvas and the list cannot drift apart on what a shot can do.
 */

export type ShotHandlers = {
  /** Auto board: propose a first shot list for the scene, replacing a proposal still waiting. */
  readonly onPropose: (sceneNodeId: string) => void
  readonly onAcceptAll: (sceneNodeId: string, shotIds: readonly string[]) => void
  readonly onAccept: (sceneNodeId: string, shotId: string) => void
  /** Discard a proposal, or remove a shot. */
  readonly onDiscard: (sceneNodeId: string, shotId: string) => void
  readonly onSave: (shotId: string, edit: ShotEdit) => void
  readonly onAdd: (sceneNodeId: string, edit: ShotEdit) => void
  readonly onMove: (shotId: string, direction: 'up' | 'down') => void
  /** Drop a shot at an index among its scene's shots (the shot itself lifted out). */
  readonly onPlace: (shotId: string, index: number) => void
  readonly onDraw: (shotId: string) => void
  readonly onCancelFrame: (jobId: string) => void
}

export type ViewProps = {
  readonly scenes: readonly StoryboardScene[]
  /** The selected scene's heading node id. Component state (open decision 10). */
  readonly selected: string | null
  readonly onSelect: (sceneNodeId: string) => void
  /** `matchesFilter` applied - a view draws these and says when a scene has none. */
  readonly visible: (shot: ShotRow) => boolean
  readonly display: DisplayOptions
  readonly labels: readonly MentionLabel[]
  readonly book: LabelBook
  /** `FRAME_GENERATION_COST`, named on every draw button before it is spent. */
  readonly cost: number
  readonly available: number
  /** A write is in flight; every button waits. */
  readonly pending: boolean
  readonly handlers: ShotHandlers
}
