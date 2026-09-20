// @vitest-environment node
import type { ExchangeRow, Relationship } from '@folio/contracts'
import { characterId, nodeId } from '@folio/script'
import type { CharacterId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  GRAPH_TILE,
  authoredEdges,
  bezierPoint,
  chordLabelAnchor,
  chordPath,
  circleLayout,
  dialogueEdges,
  edgeCurve,
  edgeEnds,
  edgeLabelAnchor,
  edgePath,
  foldAngle,
  forceLayout,
  strokeOf,
} from '../lib/characters/graph'
import type { GraphNode } from '../lib/characters/graph'

/**
 * The Relationships graph - `lib/characters/graph.ts`. The layouts must be
 * deterministic and bounded; the edges must leave a tile at its border.
 */

const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const node = (n: number) => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const cast = (n: number): readonly GraphNode[] => Array.from({ length: n }, (_, i) => ({ id: person(i + 1), name: `P${String(i + 1)}`, hue: (i % 10) + 1 }))
const size = { width: 900, height: 600 }
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

const relationship = (a: number, b: number, aIs: string, bIs: string): Relationship => ({
  aId: person(a),
  bId: person(b),
  aIs,
  bIs,
  description: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
})

describe('edges', () => {
  it('an authored edge carries both labels and weight one', () => {
    expect(authoredEdges([relationship(1, 2, 'sister', 'brother')])).toEqual([{ a: person(1), b: person(2), aIs: 'sister', bIs: 'brother', weight: 1 }])
  })

  it('dialogue edges are one per pair, sorted, weighted by scenes, the larger side winning, dead records dropped', () => {
    const exchanges = (other: number, scenes: number): ExchangeRow => ({ other: person(other), count: scenes * 2, scenes: Array.from({ length: scenes }, (_, i) => node(i + 1)) })
    const rows = [
      { id: person(2), exchanges: [exchanges(1, 3), exchanges(3, 1)] },
      { id: person(1), exchanges: [exchanges(2, 2), exchanges(9, 4)] },
      { id: person(3), exchanges: [exchanges(2, 1)] },
    ]
    const live = new Set([person(1), person(2), person(3)])
    expect(dialogueEdges(rows, live)).toEqual([
      { a: person(1), b: person(2), weight: 3 },
      { a: person(2), b: person(3), weight: 1 },
    ])
  })
})

describe('the force layout', () => {
  it('is deterministic - two runs give the same points', () => {
    const nodes = cast(6)
    const edges = [
      { a: person(1), b: person(2), weight: 1 },
      { a: person(2), b: person(3), weight: 4 },
    ]
    expect([...forceLayout(nodes, edges, size).entries()]).toEqual([...forceLayout(nodes, edges, size).entries()])
  })

  it('one node sits at the centre; none gives an empty map', () => {
    expect(forceLayout(cast(1), [], size).get(person(1))).toEqual({ x: 450, y: 300 })
    expect(forceLayout([], [], size).size).toBe(0)
  })

  it('keeps every node inside the pad', () => {
    const positions = forceLayout(cast(12), [], size)
    for (const point of positions.values()) {
      expect(point.x).toBeGreaterThanOrEqual(60)
      expect(point.x).toBeLessThanOrEqual(size.width - 60)
      expect(point.y).toBeGreaterThanOrEqual(60)
      expect(point.y).toBeLessThanOrEqual(size.height - 60)
    }
  })

  it('a connected pair ends closer than an unconnected one', () => {
    const nodes = cast(5)
    const positions = forceLayout(nodes, [{ a: person(1), b: person(2), weight: 1 }], size)
    const p = (n: number) => positions.get(person(n)) ?? { x: 0, y: 0 }
    const connected = dist(p(1), p(2))
    const apart = Math.min(dist(p(1), p(3)), dist(p(1), p(4)), dist(p(1), p(5)))
    expect(connected).toBeLessThan(apart)
  })
})

describe('the circle', () => {
  it('spaces the cast evenly around the centre', () => {
    const positions = circleLayout(cast(4), size)
    const centre = { x: 450, y: 300 }
    const radii = [...positions.values()].map((point) => dist(point, centre))
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0] ?? 0, 6)
    const at = (n: number) => positions.get(person(n)) ?? centre
    expect(dist(at(1), at(2))).toBeCloseTo(dist(at(2), at(3)), 6)
    expect(circleLayout(cast(1), size).get(person(1))).toEqual(centre)
  })
})

describe('edge geometry', () => {
  const a = { x: 0, y: 0, ...GRAPH_TILE }
  const b = { x: 300, y: 0, ...GRAPH_TILE }

  it('an edge leaves a tile at its border, on the line between centres', () => {
    const { from, to } = edgeEnds(a, b)
    expect(from).toEqual({ x: GRAPH_TILE.width, y: GRAPH_TILE.height / 2 })
    expect(to).toEqual({ x: 300, y: GRAPH_TILE.height / 2 })
  })

  it('the thread with no bulge is the line; with one, its midpoint sits off it', () => {
    const straight = edgeCurve(a, b, 0)
    expect(bezierPoint(straight, 0.5)).toEqual({ x: 186, y: 45 })
    const bent = edgeCurve(a, b, 28)
    expect(bezierPoint(bent, 0.5).y).not.toBe(45)
    expect(edgePath(a, b, 0)).toMatch(/^M 72 45 C /)
    expect(chordPath({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 })).toBe('M 0 0 Q 5 5 10 0')
    expect(chordLabelAnchor({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, 0.5)).toEqual({ point: { x: 5, y: 2.5 }, angle: 0 })
  })

  it('folds an angle into (-90, 90] so a label never reads upside down', () => {
    expect(foldAngle(0)).toBe(0)
    expect(foldAngle(90)).toBe(90)
    expect(foldAngle(135)).toBe(-45)
    expect(foldAngle(180)).toBe(0)
    expect(foldAngle(-135)).toBe(45)
    expect(foldAngle(270)).toBe(90)
    expect(edgeLabelAnchor({ x: 0, y: 0 }, { x: -100, y: 0 }, 0.22)).toEqual({ point: { x: -22, y: 0 }, angle: 0 })
  })

  it('a dialogue stroke widens with the log of the scenes, never past 4', () => {
    expect(strokeOf(1)).toBe(1)
    expect(strokeOf(2)).toBe(2)
    expect(strokeOf(64)).toBe(4)
  })
})
