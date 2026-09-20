// @vitest-environment node
import { characterId } from '@folio/script'
import type { CharacterId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { CANVAS_PAD, CHAR_COLUMNS, CHAR_GAP, CHAR_NODE_MIN_H, CHAR_NODE_W, characterBounds, characterPositions } from '../lib/characters/canvas'
import { firstFreeCell, gridLayout, intersects } from '../lib/workspace/canvas'
import type { Rect } from '../lib/storyboard/canvas'

/**
 * The Characters canvas's geometry - `lib/workspace/canvas.ts` and
 * `lib/characters/canvas.ts`. The view trusts these for where a card goes.
 */

const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const cell = { width: CHAR_NODE_W, height: CHAR_NODE_MIN_H }

describe('intersects', () => {
  it('overlap by any area, but not edge-to-edge contact', () => {
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 }
    expect(intersects(a, { x: 9, y: 9, width: 10, height: 10 })).toBe(true)
    expect(intersects(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
    expect(intersects(a, { x: 0, y: 10, width: 10, height: 10 })).toBe(false)
    expect(intersects(a, { x: 20, y: 20, width: 10, height: 10 })).toBe(false)
  })
})

describe('the grid', () => {
  it('walks columns across, then rows down, from the pad', () => {
    expect(gridLayout(0, 4, cell, CHAR_GAP, CANVAS_PAD)).toEqual({ x: CANVAS_PAD.x, y: CANVAS_PAD.y })
    expect(gridLayout(1, 4, cell, CHAR_GAP, CANVAS_PAD)).toEqual({ x: CANVAS_PAD.x + CHAR_NODE_W + CHAR_GAP, y: CANVAS_PAD.y })
    expect(gridLayout(4, 4, cell, CHAR_GAP, CANVAS_PAD)).toEqual({ x: CANVAS_PAD.x, y: CANVAS_PAD.y + CHAR_NODE_MIN_H + CHAR_GAP })
  })

  it('the first free cell skips cells any rect touches, even half over', () => {
    const first = gridLayout(0, 4, cell, CHAR_GAP, CANVAS_PAD)
    const taken: Rect[] = [{ x: first.x + 100, y: first.y + 100, width: 50, height: 50 }]
    expect(firstFreeCell(taken, 4, cell, CHAR_GAP, CANVAS_PAD)).toEqual(gridLayout(1, 4, cell, CHAR_GAP, CANVAS_PAD))
    expect(firstFreeCell([], 4, cell, CHAR_GAP, CANVAS_PAD)).toEqual(first)
  })
})

describe('character positions', () => {
  const sizes = new Map()

  it('a stored position wins; unplaced cards fill the grid in order, after the placed ones', () => {
    const positions = characterPositions(
      [
        { id: person(1), canvas: null },
        { id: person(2), canvas: { x: CANVAS_PAD.x, y: CANVAS_PAD.y } },
        { id: person(3), canvas: null },
      ],
      sizes,
    )
    expect(positions.get(person(2))).toEqual({ x: CANVAS_PAD.x, y: CANVAS_PAD.y })
    // The stored card holds cell 0, so the first unplaced takes cell 1 and the next cell 2.
    expect(positions.get(person(1))).toEqual(gridLayout(1, CHAR_COLUMNS, cell, CHAR_GAP, CANVAS_PAD))
    expect(positions.get(person(3))).toEqual(gridLayout(2, CHAR_COLUMNS, cell, CHAR_GAP, CANVAS_PAD))
  })

  it('is deterministic: the same rows give the same picture', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: person(i + 1), canvas: i === 3 ? { x: 900, y: 40 } : null }))
    expect([...characterPositions(rows, sizes).entries()]).toEqual([...characterPositions(rows, sizes).entries()])
  })

  it('a new card lands on the first free cell, and no two cards share one', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: person(i + 1), canvas: null }))
    const positions = characterPositions(rows, sizes)
    const rects = [...positions.values()].map((point) => ({ ...point, ...cell }))
    rects.forEach((a, i) => rects.forEach((b, j) => expect(i === j || !intersects(a, b)).toBe(true)))
    expect(positions.get(person(5))).toEqual(gridLayout(4, CHAR_COLUMNS, cell, CHAR_GAP, CANVAS_PAD))
  })

  it('bounds cover every card at its measured size, null with none', () => {
    expect(characterBounds(new Map(), sizes)).toBeNull()
    const measured = new Map([[person(1), { width: CHAR_NODE_W, height: 600 }]])
    const positions = characterPositions([{ id: person(1), canvas: null }], measured)
    expect(characterBounds(positions, measured)).toEqual({ x: CANVAS_PAD.x, y: CANVAS_PAD.y, width: CHAR_NODE_W, height: 600 })
  })
})
