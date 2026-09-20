import type { ExchangeRow, Relationship } from '@folio/contracts'
import type { CharacterId } from '@folio/script'

import type { Point, Rect, Size } from '../storyboard/canvas'
import type { ViewTab } from '../workspace/views'
import { orderPair, pairKey } from './relationships'

/**
 * The Relationships view's arithmetic, pure and tested
 * (`tests/characters-graph.test.ts`): the graph's nodes and edges, three
 * layouts, and the geometry an edge and its labels are drawn with.
 *
 * ## Deterministic, and drawn once
 *
 * The force layout is Fruchterman-Reingold run **synchronously to a fixed
 * iteration count** with no randomness - seeded on a circle by index,
 * cooled linearly - so the same cast and edges give the same picture on
 * every visit and the picture never moves on its own (the design's
 * "nothing else animates": the only motion on the route is the canvas
 * threads' dash, ruled 2026-09-17). Switching layouts is instant. A tile
 * the writer drags keeps its point (the view's `overrides`) until
 * `Relayout`.
 *
 * ## Three layouts, two kinds of edge
 *
 *   Force      the authored relationships (`character_relationships`) as
 *              springs, each edge with its two labels
 *   Dialogue   the same layout over the script's own answer to who talks
 *              to whom - `character_derivations.exchanges`, one edge per
 *              pair that speaks, its width from how many scenes they do -
 *              unlabelled, since the script wrote it
 *   Chord      the cast on a circle in cast order, the authored edges as
 *              chords bent through the centre
 *
 * Nothing here reads a node or calls a model. The exchange counts are the
 * derivation's; the labels are the writer's.
 */

export type GraphNode = {
  readonly id: CharacterId
  readonly name: string
  readonly hue: number
}

/** An authored edge: the pair sorted, the two directional labels, a weight of one. */
export type GraphEdge = {
  readonly a: CharacterId
  readonly b: CharacterId
  readonly aIs: string
  readonly bIs: string
  readonly weight: number
}

/** A derived edge: the pair sorted, weighted by the scenes they exchange lines in. */
export type DialogueEdge = {
  readonly a: CharacterId
  readonly b: CharacterId
  readonly weight: number
}

export type GraphLayout = 'force' | 'dialogue' | 'chord'

export const GRAPH_LAYOUTS: readonly ViewTab<GraphLayout>[] = [
  { id: 'force', title: 'Force' },
  { id: 'dialogue', title: 'Dialogue' },
  { id: 'chord', title: 'Chord' },
]

/** A tile: the 72×90 colour block with the name pill under it. */
export const GRAPH_TILE: Size = { width: 72, height: 90 }

export const authoredEdges = (relationships: readonly Relationship[]): readonly GraphEdge[] =>
  relationships.map((row) => ({ a: row.aId, b: row.bId, aIs: row.aIs, bIs: row.bIs, weight: 1 }))

/**
 * Who talks to whom, from each record's `exchanges`: one edge per pair
 * with both records live, `a < b`, deduped - the derivation writes the
 * exchange on both sides, and a count that differs between them (it
 * should not) reads as the larger. Sorted by the pair key so the list is
 * the same whatever order the rows came in.
 */
export const dialogueEdges = (
  rows: readonly { readonly id: CharacterId; readonly exchanges: readonly ExchangeRow[] }[],
  live: ReadonlySet<CharacterId>,
): readonly DialogueEdge[] => {
  const weights = new Map<string, DialogueEdge>()
  for (const row of rows) {
    if (!live.has(row.id)) continue
    for (const exchange of row.exchanges) {
      if (!live.has(exchange.other) || exchange.other === row.id) continue
      const weight = Math.max(1, exchange.scenes.length)
      const [a, b] = orderPair(row.id, exchange.other)
      const key = pairKey(a, b)
      const seen = weights.get(key)
      if (seen === undefined || seen.weight < weight) weights.set(key, { a, b, weight })
    }
  }
  return [...weights.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, edge]) => edge)
}

// ---------------------------------------------------------------------------
// Layouts - every position is a tile's centre, in the view's px
// ---------------------------------------------------------------------------

export type Positions = ReadonlyMap<CharacterId, Point>

const GRAVITY = 0.06
const PAD = 60

/** The cast on a circle, in order, radius to the view's shorter side less `pad`. One node sits at the centre. */
export const circleLayout = (nodes: readonly GraphNode[], size: Size, pad = PAD): Positions => {
  const out = new Map<CharacterId, Point>()
  const centre = { x: size.width / 2, y: size.height / 2 }
  if (nodes.length === 1 && nodes[0] !== undefined) {
    out.set(nodes[0].id, centre)
    return out
  }
  const radius = Math.max(1, Math.min(size.width, size.height) / 2 - pad)
  nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / nodes.length) * Math.PI * 2
    out.set(node.id, { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius })
  })
  return out
}

/** How hard an edge pulls: one for a relationship, up to three for a pair that talks in many scenes. */
const pullOf = (weight: number): number => Math.min(3, 1 + Math.log2(Math.max(1, weight)))

/**
 * Fruchterman-Reingold over the nodes and the edges, `iterations` steps
 * from a circle, no randomness: repulsion `k² / d` between every pair,
 * a spring `d² / k` along each edge scaled by the edge's pull, a small
 * pull to the centre so a disconnected node does not drift to the wall,
 * and a temperature that cools linearly to nothing, so the last steps
 * settle rather than jump. Every centre is clamped inside `pad`. Two
 * nodes on one point are pushed apart along a fixed axis, so the layout
 * cannot divide by zero and cannot depend on the clock.
 */
export const forceLayout = (
  nodes: readonly GraphNode[],
  edges: readonly { readonly a: CharacterId; readonly b: CharacterId; readonly weight: number }[],
  size: Size,
  iterations = 300,
  pad = PAD,
): Positions => {
  const n = nodes.length
  if (n === 0) return new Map()
  const seeded = circleLayout(nodes, size, pad)
  const index = new Map<CharacterId, number>(nodes.map((node, at) => [node.id, at]))
  const xs = nodes.map((node) => seeded.get(node.id)?.x ?? size.width / 2)
  const ys = nodes.map((node) => seeded.get(node.id)?.y ?? size.height / 2)
  if (n === 1) return seeded

  const width = Math.max(1, size.width - pad * 2)
  const height = Math.max(1, size.height - pad * 2)
  const k = Math.sqrt((width * height) / n) * 0.6
  const centre = { x: size.width / 2, y: size.height / 2 }
  const links = edges.flatMap((edge) => {
    const a = index.get(edge.a)
    const b = index.get(edge.b)
    return a === undefined || b === undefined || a === b ? [] : [{ a, b, pull: pullOf(edge.weight) }]
  })
  const t0 = Math.min(width, height) / 8

  const dx = new Array<number>(n).fill(0)
  const dy = new Array<number>(n).fill(0)
  for (let step = 0; step < iterations; step += 1) {
    const t = t0 * (1 - step / iterations)
    dx.fill(0)
    dy.fill(0)
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let vx = (xs[i] ?? 0) - (xs[j] ?? 0)
        let vy = (ys[i] ?? 0) - (ys[j] ?? 0)
        let d = Math.hypot(vx, vy)
        if (d < 0.01) {
          // Coincident: push apart along a fixed axis by their index gap, so the result is still a function of the input.
          vx = j - i
          vy = 0.5 * (j - i)
          d = Math.hypot(vx, vy)
        }
        const force = (k * k) / d
        const fx = (vx / d) * force
        const fy = (vy / d) * force
        dx[i] = (dx[i] ?? 0) + fx
        dy[i] = (dy[i] ?? 0) + fy
        dx[j] = (dx[j] ?? 0) - fx
        dy[j] = (dy[j] ?? 0) - fy
      }
    }
    for (const link of links) {
      const vx = (xs[link.a] ?? 0) - (xs[link.b] ?? 0)
      const vy = (ys[link.a] ?? 0) - (ys[link.b] ?? 0)
      const d = Math.hypot(vx, vy)
      if (d < 0.01) continue
      const force = ((d * d) / k) * link.pull
      const fx = (vx / d) * force
      const fy = (vy / d) * force
      dx[link.a] = (dx[link.a] ?? 0) - fx
      dy[link.a] = (dy[link.a] ?? 0) - fy
      dx[link.b] = (dx[link.b] ?? 0) + fx
      dy[link.b] = (dy[link.b] ?? 0) + fy
    }
    for (let i = 0; i < n; i += 1) {
      const gx = (centre.x - (xs[i] ?? 0)) * GRAVITY
      const gy = (centre.y - (ys[i] ?? 0)) * GRAVITY
      const mx = (dx[i] ?? 0) + gx
      const my = (dy[i] ?? 0) + gy
      const m = Math.hypot(mx, my)
      if (m < 0.0001) continue
      const move = Math.min(m, t)
      xs[i] = clamp((xs[i] ?? 0) + (mx / m) * move, pad, size.width - pad)
      ys[i] = clamp((ys[i] ?? 0) + (my / m) * move, pad, size.height - pad)
    }
  }
  const out = new Map<CharacterId, Point>()
  nodes.forEach((node, at) => {
    out.set(node.id, { x: round(xs[at] ?? 0), y: round(ys[at] ?? 0) })
  })
  return out
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))
const round = (value: number): number => Math.round(value * 100) / 100

// ---------------------------------------------------------------------------
// Edges - where a line leaves a tile, and where a label sits on it
// ---------------------------------------------------------------------------

const centreOf = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

/** Where the line from `rect`'s centre toward `to` crosses `rect`'s border. */
const clipToRect = (rect: Rect, to: Point): Point => {
  const c = centreOf(rect)
  const vx = to.x - c.x
  const vy = to.y - c.y
  if (Math.abs(vx) < 0.0001 && Math.abs(vy) < 0.0001) return c
  const sx = Math.abs(vx) < 0.0001 ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(vx)
  const sy = Math.abs(vy) < 0.0001 ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(vy)
  const s = Math.min(sx, sy)
  return { x: c.x + vx * s, y: c.y + vy * s }
}

/** The centre-to-centre line between two rects, clipped to each border. */
export const edgeEnds = (a: Rect, b: Rect): { readonly from: Point; readonly to: Point } => ({
  from: clipToRect(a, centreOf(b)),
  to: clipToRect(b, centreOf(a)),
})

export type Cubic = { readonly from: Point; readonly c1: Point; readonly c2: Point; readonly to: Point }

/**
 * The canvas thread between two cards: the clipped line with both handles
 * pushed `bulge` px to one side, so two threads between neighbouring cards
 * read as curves rather than one straight rule. `bulge` 0 is the line.
 */
export const edgeCurve = (a: Rect, b: Rect, bulge = 28): Cubic => {
  const { from, to } = edgeEnds(a, b)
  const vx = to.x - from.x
  const vy = to.y - from.y
  const d = Math.hypot(vx, vy) || 1
  const nx = (-vy / d) * bulge
  const ny = (vx / d) * bulge
  return {
    from,
    c1: { x: from.x + vx / 3 + nx, y: from.y + vy / 3 + ny },
    c2: { x: from.x + (vx * 2) / 3 + nx, y: from.y + (vy * 2) / 3 + ny },
    to,
  }
}

const fmt = (value: number): string => String(Math.round(value * 100) / 100)

export const edgePath = (a: Rect, b: Rect, bulge = 28): string => {
  const { from, c1, c2, to } = edgeCurve(a, b, bulge)
  return `M ${fmt(from.x)} ${fmt(from.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(to.x)} ${fmt(to.y)}`
}

/** A chord: a quadratic from `a` to `b` bent through `centre`. */
export const chordPath = (a: Point, b: Point, centre: Point): string =>
  `M ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(centre.x)} ${fmt(centre.y)} ${fmt(b.x)} ${fmt(b.y)}`

/** The point at `t` on a cubic. */
export const bezierPoint = (curve: Cubic, t: number): Point => {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return {
    x: w0 * curve.from.x + w1 * curve.c1.x + w2 * curve.c2.x + w3 * curve.to.x,
    y: w0 * curve.from.y + w1 * curve.c1.y + w2 * curve.c2.y + w3 * curve.to.y,
  }
}

/** An angle in degrees folded into (−90, 90], so a label along a line never reads upside down. */
export const foldAngle = (degrees: number): number => {
  let angle = degrees % 360
  if (angle > 180) angle -= 360
  if (angle <= -180) angle += 360
  if (angle > 90) angle -= 180
  if (angle <= -90) angle += 180
  return angle
}

/** Where a label sits on the straight line `from` → `to`: the point at `t`, and the line's angle, folded. */
export const edgeLabelAnchor = (from: Point, to: Point, t: number): { readonly point: Point; readonly angle: number } => ({
  point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
  angle: foldAngle((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI),
})

/** Where a label sits on a chord: the quadratic's point at `t`, and its tangent's angle, folded. */
export const chordLabelAnchor = (a: Point, b: Point, centre: Point, t: number): { readonly point: Point; readonly angle: number } => {
  const u = 1 - t
  const point = { x: u * u * a.x + 2 * u * t * centre.x + t * t * b.x, y: u * u * a.y + 2 * u * t * centre.y + t * t * b.y }
  const tx = 2 * u * (centre.x - a.x) + 2 * t * (b.x - centre.x)
  const ty = 2 * u * (centre.y - a.y) + 2 * t * (b.y - centre.y)
  return { point, angle: foldAngle((Math.atan2(ty, tx) * 180) / Math.PI) }
}

/** A dialogue edge's stroke: 1px for one scene, wider with more, never past 4. */
export const strokeOf = (weight: number): number => Math.min(4, 1 + Math.log2(Math.max(1, weight)))
