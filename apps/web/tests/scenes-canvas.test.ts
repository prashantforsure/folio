// @vitest-environment node
import { nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { CANVAS_PAD, SCENE_NODE_W, openingWindow, sceneStatus, scenePosition, tileBadge } from '../lib/scenes/canvas'
import { NODE_GAP, autoLayout, fitTransform } from '../lib/storyboard/canvas'
import type { Rect } from '../lib/storyboard/canvas'

/**
 * The Scenes canvas's geometry. The view trusts these for where a card goes
 * and where the canvas opens.
 */

const a = nodeId('11111111-1111-4111-8111-111111111111')
const b = nodeId('22222222-2222-4222-8222-222222222222')

describe('positions', () => {
  it('a card nobody has moved sits in the sequence row; a moved one where it was dropped', () => {
    const positions = new Map([[b, { x: 900, y: 240 }]])
    expect(scenePosition(positions, a, 0)).toEqual(autoLayout(0))
    expect(scenePosition(positions, a, 0)).toEqual({ x: CANVAS_PAD.x, y: CANVAS_PAD.y })
    expect(scenePosition(positions, b, 1)).toEqual({ x: 900, y: 240 })
  })

  it('a scene card is exactly a shot node wide, so the row steps like the storyboard', () => {
    expect(autoLayout(1).x - autoLayout(0).x).toBe(SCENE_NODE_W + NODE_GAP)
  })
})

describe('opening window', () => {
  const viewport = { width: 1200, height: 800 }
  const row = (cards: number): Rect => ({
    x: CANVAS_PAD.x,
    y: CANVAS_PAD.y,
    width: cards * SCENE_NODE_W + (cards - 1) * NODE_GAP,
    height: 420,
  })

  it('a row that fits is fitted whole, centred at 100%', () => {
    const bounds = row(3)
    expect(openingWindow(bounds, viewport)).toEqual(bounds)
    const t = fitTransform(openingWindow(bounds, viewport), viewport)
    expect(t.k).toBe(1)
  })

  it('a row wider than the viewport opens at its left edge, at a scale that shows a whole card', () => {
    const bounds = row(40)
    const window = openingWindow(bounds, viewport)
    expect(window.x).toBe(bounds.x)
    expect(window.width).toBe(viewport.width - 80)
    const t = fitTransform(window, viewport)
    expect(t.k).toBe(1)
    // The first card's left edge lands at the fit's padding, not off-screen and not centred.
    expect(t.x + bounds.x * t.k).toBe(40)
    // And a fit of the whole row would have been the floor, unreadable.
    expect(fitTransform(bounds, viewport).k).toBeLessThan(0.3)
  })

  it('a short viewport still shows a whole card by scaling down', () => {
    const bounds = row(40)
    const t = fitTransform(openingWindow(bounds, { width: 1200, height: 300 }), { width: 1200, height: 300 })
    expect(t.k).toBeCloseTo(220 / 420, 5)
  })
})

describe('status and badge', () => {
  it('a synopsis makes a scene Ready; blank or missing is Draft', () => {
    expect(sceneStatus(null)).toBe('draft')
    expect(sceneStatus('   ')).toBe('draft')
    expect(sceneStatus('Maya finds the Kestrel gone.')).toBe('ready')
  })

  it('the tile badge is INT / EXT and the time, whichever read, and nothing when neither did', () => {
    expect(tileBadge({ ie: 'INT', timeOfDay: 'Dawn' })).toBe('INT · DAWN')
    expect(tileBadge({ ie: 'EXT', timeOfDay: null })).toBe('EXT')
    expect(tileBadge({ ie: null, timeOfDay: 'NIGHT' })).toBe('NIGHT')
    expect(tileBadge({ ie: null, timeOfDay: null })).toBeNull()
  })
})
