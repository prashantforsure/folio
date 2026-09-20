import type { CanvasPosition } from '@folio/contracts'
import type { CharacterId } from '@folio/script'

import { openingWindow } from '../scenes/canvas'
import { CANVAS_PAD, NODE_W, boundsOf } from '../storyboard/canvas'
import type { Point, Rect, Size } from '../storyboard/canvas'
import { firstFreeCell } from '../workspace/canvas'

/**
 * The Characters canvas's geometry, pure and tested
 * (`tests/characters-canvas.test.ts`). The canvas is the Storyboard's
 * (2026-09-17) with a character per card - the fourth pass, 2026-09-20,
 * on the client's ruling that laper.ai's route shape is the reference.
 * The world, the zoom, the fit and the thread's path are
 * `lib/storyboard/canvas.ts`, imported, not copied; the opening window
 * is Scenes'. What is this route's is here.
 *
 * ## Where a card sits
 *
 * A card's width is a shot node's, so the three canvases draw one node.
 * A card the writer has moved sits where `characters.canvas_x / canvas_y`
 * say (`0024`, persisted on drop - ruling 3). A card nobody has moved
 * takes the first free cell of a four-column grid, in cast order, after
 * every stored card has been placed - so the layout is a function of the
 * rows and is the same on every load, a new card lands beside the last
 * without a write, and a stored card never shares a cell with an unplaced
 * one. Heights are measured by the view; the floor below is what the
 * layout assumes before a card reports its own.
 */

/** A character card's width: a shot node's. */
export const CHAR_NODE_W = NODE_W
/** The floor a layout assumes before a card is measured: the tab strip, the face, the chips, two lines of bio, the two button rows. */
export const CHAR_NODE_MIN_H = 560
export const CHAR_COLUMNS = 4
export const CHAR_GAP = 28
export { CANVAS_PAD, openingWindow }

export type CharacterPositions = ReadonlyMap<CharacterId, Point>

/**
 * Every card's world point, in the given order: the stored position where
 * one exists, else the first free grid cell after every placed card.
 * Deterministic - the same rows give the same picture.
 */
export const characterPositions = (
  order: readonly { readonly id: CharacterId; readonly canvas: CanvasPosition | null }[],
  sizes: ReadonlyMap<CharacterId, Size>,
): CharacterPositions => {
  const sizeOf = (id: CharacterId): Size => sizes.get(id) ?? { width: CHAR_NODE_W, height: CHAR_NODE_MIN_H }
  const out = new Map<CharacterId, Point>()
  const taken: Rect[] = []
  for (const record of order) {
    if (record.canvas === null) continue
    out.set(record.id, { x: record.canvas.x, y: record.canvas.y })
    taken.push({ x: record.canvas.x, y: record.canvas.y, ...sizeOf(record.id) })
  }
  const cell = { width: CHAR_NODE_W, height: CHAR_NODE_MIN_H }
  for (const record of order) {
    if (record.canvas !== null) continue
    const point = firstFreeCell(taken, CHAR_COLUMNS, cell, CHAR_GAP, CANVAS_PAD)
    out.set(record.id, point)
    taken.push({ ...point, ...sizeOf(record.id) })
  }
  return out
}

/** The box around every card, or null with none. */
export const characterBounds = (positions: CharacterPositions, sizes: ReadonlyMap<CharacterId, Size>): Rect | null =>
  boundsOf(
    [...positions.entries()].map(([id, point]) => {
      const size = sizes.get(id) ?? { width: CHAR_NODE_W, height: CHAR_NODE_MIN_H }
      return { x: point.x, y: point.y, width: size.width, height: size.height }
    }),
  )
