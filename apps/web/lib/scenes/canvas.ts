import type { NodeId } from '@folio/script'

import { CANVAS_PAD, NODE_W, autoLayout } from '../storyboard/canvas'
import type { Point, Rect, Size } from '../storyboard/canvas'

/**
 * The Scenes canvas's geometry, pure and tested (`tests/scenes-canvas.test.ts`).
 *
 * The canvas is the Storyboard's (2026-09-17, "Redesign phase 3, second
 * pass"): one world div under a `translate() scale()`, cards on it, a
 * thread from each to the next in story order. Everything about the world
 * that is not scene-specific - the transform, the zoom about a point, the
 * fit, the thread's path - is `lib/storyboard/canvas.ts` and is imported,
 * not copied, so the two canvases cannot drift. What is scene-specific is
 * here: a card's width is a shot node's, so the two routes draw one node;
 * where a card sits when nobody has moved it; and where the canvas opens.
 *
 * ## Positions are component state this pass
 *
 * A shot's position persists (`shots.canvas_x` / `canvas_y`, migration
 * `0020`, by ruling). A scene's does not yet: `scenes` has no such column
 * and adding one is a schema decision the pass did not take
 * (`docs/build-decisions.md`, "Redesign phase 8"). So a position is the
 * map the view holds while mounted, and `scenePosition` reads it the way
 * `nodePosition` reads the row - a moved card's point, else its place in
 * the sequence.
 *
 * ## The opening window
 *
 * A storyboard canvas holds one scene's shots and fits them all. An episode
 * holds every scene - eleven here, forty in an hour, two hundred in a
 * feature - and a fit that showed all of them would be the minimum zoom
 * with nothing readable. So the canvas *opens* on the start of the row at a
 * readable scale: `openingWindow` is the rect that, handed to the same
 * `fit`, shows the first cards at 100% from the left edge, or the whole row
 * when it fits. `Fit` on the zoom pill still fits everything; that is what
 * the button says.
 */

/** A scene card's width: a shot node's, so the two canvases draw one node. */
export const SCENE_NODE_W = NODE_W
/** The floor a layout and a fit assume before a card has been measured. */
export const SCENE_NODE_MIN_H = 420
export { CANVAS_PAD }

export type ScenePositions = ReadonlyMap<NodeId, Point>

/** A moved card's point, else its place in the sequence - the auto layout's row. */
export const scenePosition = (positions: ScenePositions, id: NodeId, index: number): Point =>
  positions.get(id) ?? autoLayout(index)

/**
 * The rect to fit on open. When the bounds fit in the viewport, the bounds:
 * the fit centres them at 100% or less. When the row is wider than the
 * viewport, a window as wide as the viewport's usable width from the row's
 * left edge and as tall as the row: the fit lands at the row's start, at the
 * largest scale that shows a whole card, and the rest of the row hangs off
 * to the right for the pan. `pad` is the fit's own.
 */
export const openingWindow = (bounds: Rect, viewport: Size, pad = 40): Rect => {
  const usable = Math.max(1, viewport.width - pad * 2)
  if (bounds.width <= usable) return bounds
  return { x: bounds.x, y: bounds.y, width: usable, height: bounds.height }
}

/** `Ready` once a synopsis is written, `Draft` until then - the mockup's two words. */
export type SceneStatus = 'ready' | 'draft'

export const sceneStatus = (synopsis: string | null): SceneStatus =>
  synopsis !== null && synopsis.trim() !== '' ? 'ready' : 'draft'

export const SCENE_STATUS_LABEL: Readonly<Record<SceneStatus, string>> = {
  ready: 'Ready',
  draft: 'Draft',
}

/**
 * The mono badge over a card's script tile, where a shot's tile prints
 * `WS · 24mm`: the heading's `INT` / `EXT` and its time of day, whichever
 * read. Nothing when neither did - a badge that said `—` would be noise
 * over the text.
 */
export const tileBadge = (reading: { readonly ie: string | null; readonly timeOfDay: string | null }): string | null => {
  const parts = [reading.ie, reading.timeOfDay].filter((part): part is string => part !== null && part !== '')
  return parts.length === 0 ? null : parts.map((part) => part.toUpperCase()).join(' · ')
}
