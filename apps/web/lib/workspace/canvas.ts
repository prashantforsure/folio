import type { Point, Rect, Size } from '../storyboard/canvas'

/**
 * Canvas geometry that is nobody's route: a grid layout and its free cell,
 * and whether two rects touch. Pure; tested in `tests/characters-canvas.test.ts`.
 *
 * The Storyboard's and Scenes' canvases lay their cards out in one row
 * (`autoLayout`, `lib/storyboard/canvas.ts`) because a row is a sequence.
 * A cast is not a sequence: the Characters canvas (2026-09-20) lays its
 * cards out on a grid, `columns` across, and a new card lands on the first
 * cell nothing occupies - so `+ New character` needs no write to place
 * the card, and a card nobody has moved has a place it comes back to.
 * The types are the Storyboard's, as `lib/scenes/canvas.ts` takes them, so
 * the three canvases share one world.
 */

/** Whether two rects overlap by any area. Edge-to-edge contact is not an overlap. */
export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Where the `index`-th card of a grid sits: `columns` across, `cell` each, `gap` between, from `pad`. */
export const gridLayout = (index: number, columns: number, cell: Size, gap: number, pad: Point): Point => {
  const across = Math.max(1, columns)
  const column = index % across
  const row = Math.floor(index / across)
  return { x: pad.x + column * (cell.width + gap), y: pad.y + row * (cell.height + gap) }
}

/**
 * The first grid cell no rect in `taken` overlaps, walking the grid in
 * reading order. A card dragged half over a cell takes it; the search
 * always ends, since the grid is unbounded downward and the rects are not.
 */
export const firstFreeCell = (taken: readonly Rect[], columns: number, cell: Size, gap: number, pad: Point): Point => {
  for (let index = 0; ; index += 1) {
    const point = gridLayout(index, columns, cell, gap, pad)
    const candidate: Rect = { x: point.x, y: point.y, width: cell.width, height: cell.height }
    if (!taken.some((rect) => intersects(rect, candidate))) return point
  }
}
