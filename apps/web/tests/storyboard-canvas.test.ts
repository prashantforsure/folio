// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  CANVAS_PAD,
  NODE_GAP,
  NODE_W,
  ZOOM_MAX,
  ZOOM_MIN,
  autoLayout,
  boundsOf,
  clampZoom,
  connectorEnds,
  connectorPath,
  fitTransform,
  nextZoomStep,
  nodePosition,
  worldFromClient,
  zoomAt,
  zoomLabel,
} from '../lib/storyboard/canvas'
import type { Rect } from '../lib/storyboard/canvas'

/**
 * The canvas's geometry. The view trusts these for where a card goes, where
 * a thread runs, and what a wheel zoom keeps still.
 */

const rect = (x: number, y: number, width = NODE_W, height = 400): Rect => ({ x, y, width, height })

describe('layout', () => {
  it('lays the sequence out in a row from the mockup padding', () => {
    expect(autoLayout(0)).toEqual({ x: CANVAS_PAD.x, y: CANVAS_PAD.y })
    expect(autoLayout(3)).toEqual({ x: CANVAS_PAD.x + 3 * (NODE_W + NODE_GAP), y: CANVAS_PAD.y })
  })

  it('a stored position wins; either null means auto', () => {
    expect(nodePosition({ canvasX: 500, canvasY: 120 }, 2)).toEqual({ x: 500, y: 120 })
    expect(nodePosition({ canvasX: null, canvasY: null }, 2)).toEqual(autoLayout(2))
    expect(nodePosition({ canvasX: 500, canvasY: null }, 2)).toEqual(autoLayout(2))
  })

  it('bounds box every rect, and nothing is null', () => {
    expect(boundsOf([])).toBeNull()
    expect(boundsOf([rect(10, 20), rect(400, -30, 100, 50)])).toEqual({ x: 10, y: -30, width: 490, height: 450 })
  })
})

describe('the thread', () => {
  it('runs from the right mid-edge of one card to the left mid-edge of the next', () => {
    const a = rect(0, 0)
    const b = rect(NODE_W + NODE_GAP, 0)
    expect(connectorEnds(a, b)).toEqual({ from: { x: NODE_W, y: 200 }, to: { x: NODE_W + NODE_GAP, y: 200 } })
  })

  it('is a cubic that starts and ends at those points', () => {
    const path = connectorPath(rect(0, 0), rect(NODE_W + NODE_GAP, 100))
    expect(path.startsWith(`M ${String(NODE_W)} 200 C`)).toBe(true)
    expect(path.endsWith(`, ${String(NODE_W + NODE_GAP)} 300`)).toBe(true)
  })

  it('keeps a readable curve when the next card sits behind the previous one', () => {
    const path = connectorPath(rect(600, 0), rect(0, 500))
    // From (906, 200) to (0, 700): the handles reach 453px, half the run.
    expect(path).toBe('M 906 200 C 1359 200, -453 700, 0 700')
    const near = connectorPath(rect(0, 0), rect(NODE_W + 10, 0))
    // Ten px apart, the handles still reach the 40px floor.
    expect(near).toBe(`M ${String(NODE_W)} 200 C ${String(NODE_W + 40)} 200, ${String(NODE_W + 10 - 40)} 200, ${String(NODE_W + 10)} 200`)
  })
})

describe('zoom', () => {
  it('clamps to the pill range', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(5)).toBe(ZOOM_MAX)
    expect(clampZoom(1)).toBe(1)
  })

  it('keeps the world point under the cursor still', () => {
    const before = { x: 40, y: 60, k: 1 }
    const cursor = { x: 300, y: 200 }
    const origin = { x: 0, y: 0 }
    const under = worldFromClient(before, cursor, origin)
    const after = zoomAt(before, cursor, 1.5)
    expect(after.k).toBe(1.5)
    expect(worldFromClient(after, cursor, origin)).toEqual(under)
  })

  it('steps through the pill stops and stops at the ends', () => {
    expect(nextZoomStep(1, -1)).toBe(0.9)
    expect(nextZoomStep(1, 1)).toBe(1.1)
    expect(nextZoomStep(2, 1)).toBe(2)
    expect(nextZoomStep(0.25, -1)).toBe(0.25)
    expect(zoomLabel(0.9)).toBe('90%')
  })

  it('fits the bounds centred at the largest scale up to 100%', () => {
    const wide = fitTransform({ x: 0, y: 0, width: 2000, height: 400 }, { width: 1000, height: 600 })
    expect(wide.k).toBeCloseTo(920 / 2000)
    // Horizontally the padded width is used up; vertically the 400 * k sits centred.
    expect(wide.x).toBeCloseTo(40)
    expect(wide.y).toBeCloseTo((600 - 400 * wide.k) / 2)

    const small = fitTransform({ x: 100, y: 100, width: 300, height: 200 }, { width: 1000, height: 600 })
    expect(small.k).toBe(1)
    expect(small.x).toBe((1000 - 300) / 2 - 100)
    expect(small.y).toBe((600 - 200) / 2 - 100)
  })

  it('reads a window point back into the world', () => {
    const t = { x: 100, y: 50, k: 2 }
    expect(worldFromClient(t, { x: 300, y: 250 }, { x: 0, y: 0 })).toEqual({ x: 100, y: 100 })
    expect(worldFromClient(t, { x: 310, y: 260 }, { x: 10, y: 10 })).toEqual({ x: 100, y: 100 })
  })
})
