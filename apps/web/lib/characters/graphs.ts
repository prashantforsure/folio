import type { CharacterMap } from '@folio/contracts'

/**
 * The geometry behind the three relationship graphs, each a pure function
 * over `CharacterMap` so the SVG components only draw. No dependency: a
 * ring, a greedy circle packing and a chord layout are a few dozen lines
 * each, and a force simulation would be a library for a picture that does
 * not need to move. Tested in `tests/characters-graphs.test.ts`.
 */

export type Point = { readonly x: number; readonly y: number }

// ---------------------------------------------------------------------------
// Force: a ring of tiles, edges weighted by shared scenes
// ---------------------------------------------------------------------------

export type RingNode = { readonly index: number; readonly x: number; readonly y: number }

export type Edge = { readonly a: number; readonly b: number; readonly shared: number }

/** `n` points on a circle of radius `r` about `(cx, cy)`, the first at the top, clockwise. */
export const ringLayout = (n: number, cx: number, cy: number, r: number): readonly RingNode[] => {
  if (n === 1) return [{ index: 0, x: cx, y: cy }]
  return Array.from({ length: n }, (_, index) => {
    const angle = -Math.PI / 2 + (index / n) * Math.PI * 2
    return { index, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }
  })
}

/** Every pair that shares a scene, once, strongest first. */
export const edgesOf = (map: CharacterMap): readonly Edge[] => {
  const edges: Edge[] = []
  map.cells.forEach((row, a) => {
    row.forEach((shared, b) => {
      if (b > a && shared > 0) edges.push({ a, b, shared })
    })
  })
  return edges.sort((x, y) => y.shared - x.shared)
}

// ---------------------------------------------------------------------------
// Dialogue: circles with area proportional to lines, packed about the centre
// ---------------------------------------------------------------------------

export type Bubble = { readonly index: number; readonly x: number; readonly y: number; readonly r: number }

/**
 * Greedy packing: the largest circle sits at the centre; each next circle
 * is placed touching an earlier one, at the candidate angle that keeps it
 * closest to the centre without overlapping any placed circle. Radius is
 * `sqrt(lines)` scaled so the largest is `maxR`, and never under `minR`,
 * so a character with one line is still a circle with a name in it.
 */
export const packBubbles = (
  values: readonly number[],
  maxR: number,
  minR: number,
  gap = 6,
): readonly Bubble[] => {
  const order = values.map((value, index) => ({ index, value })).sort((a, b) => b.value - a.value)
  const top = order[0]?.value ?? 0
  const radiusOf = (value: number): number =>
    top <= 0 ? minR : Math.max(minR, Math.sqrt(value / top) * maxR)
  const placed: Bubble[] = []
  const overlaps = (x: number, y: number, r: number): boolean =>
    placed.some((other) => Math.hypot(other.x - x, other.y - y) < other.r + r + gap - 0.01)

  for (const entry of order) {
    const r = radiusOf(entry.value)
    if (placed.length === 0) {
      placed.push({ index: entry.index, x: 0, y: 0, r })
      continue
    }
    let best: Bubble | null = null
    for (const anchor of placed) {
      for (let step = 0; step < 48; step += 1) {
        const angle = (step / 48) * Math.PI * 2
        const distance = anchor.r + r + gap
        const x = anchor.x + Math.cos(angle) * distance
        const y = anchor.y + Math.sin(angle) * distance
        if (overlaps(x, y, r)) continue
        if (best === null || Math.hypot(x, y) < Math.hypot(best.x, best.y)) best = { index: entry.index, x, y, r }
      }
    }
    placed.push(best ?? { index: entry.index, x: 0, y: (placed.at(-1)?.y ?? 0) + r * 2 + gap, r })
  }
  return placed
}

/** The bounding box of a packing, for the viewBox. */
export const bubbleBounds = (bubbles: readonly Bubble[]): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } => {
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  for (const bubble of bubbles) {
    minX = Math.min(minX, bubble.x - bubble.r)
    minY = Math.min(minY, bubble.y - bubble.r)
    maxX = Math.max(maxX, bubble.x + bubble.r)
    maxY = Math.max(maxY, bubble.y + bubble.r)
  }
  return { minX, minY, maxX, maxY }
}

// ---------------------------------------------------------------------------
// Chord: arcs proportional to lines, ribbons proportional to shared scenes
// ---------------------------------------------------------------------------

export type Arc = { readonly index: number; readonly start: number; readonly end: number }

export type Ribbon = {
  readonly a: number
  readonly b: number
  readonly shared: number
  /** The sub-arc on `a`'s arc, and on `b`'s, in radians. */
  readonly aStart: number
  readonly aEnd: number
  readonly bStart: number
  readonly bEnd: number
}

export type ChordLayout = { readonly arcs: readonly Arc[]; readonly ribbons: readonly Ribbon[] }

const TAU = Math.PI * 2

/**
 * Each character gets an arc proportional to their lines, with a floor so a
 * silent character is still a sliver, separated by `pad` radians; the arcs
 * total 2π minus the padding. Each shared-scene pair gets a ribbon whose
 * ends take a share of each arc proportional to that count over the
 * character's total shared scenes - so a character's ribbons tile their
 * arc and never overlap.
 */
export const chordLayout = (map: CharacterMap, pad = 0.04): ChordLayout => {
  const n = map.columns.length
  if (n === 0) return { arcs: [], ribbons: [] }
  const weights = map.columns.map((column) => Math.max(1, column.lines))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const available = TAU - pad * n
  const arcs: Arc[] = []
  let cursor = -Math.PI / 2
  weights.forEach((weight, index) => {
    const span = (weight / total) * available
    arcs.push({ index, start: cursor, end: cursor + span })
    cursor += span + pad
  })

  const sharedTotal = map.cells.map((row, i) => row.reduce((sum, cell, j) => (i === j ? sum : sum + cell), 0))
  const used = new Array<number>(n).fill(0)
  const take = (index: number, shared: number): readonly [number, number] => {
    const arc = arcs[index]
    if (arc === undefined) return [0, 0]
    const span = arc.end - arc.start
    const share = sharedTotal[index] === 0 ? 0 : (shared / (sharedTotal[index] ?? 1)) * span
    const start = arc.start + (used[index] ?? 0)
    used[index] = (used[index] ?? 0) + share
    return [start, start + share]
  }
  const ribbons: Ribbon[] = []
  for (const edge of edgesOf(map)) {
    const [aStart, aEnd] = take(edge.a, edge.shared)
    const [bStart, bEnd] = take(edge.b, edge.shared)
    ribbons.push({ a: edge.a, b: edge.b, shared: edge.shared, aStart, aEnd, bStart, bEnd })
  }
  return { arcs, ribbons }
}

export const polar = (cx: number, cy: number, r: number, angle: number): Point => ({
  x: cx + Math.cos(angle) * r,
  y: cy + Math.sin(angle) * r,
})

/** An SVG annulus sector path between `r0` and `r1` from `start` to `end`. */
export const arcPath = (cx: number, cy: number, r0: number, r1: number, start: number, end: number): string => {
  const large = end - start > Math.PI ? 1 : 0
  const o0 = polar(cx, cy, r1, start)
  const o1 = polar(cx, cy, r1, end)
  const i0 = polar(cx, cy, r0, end)
  const i1 = polar(cx, cy, r0, start)
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${r1} ${r1} 0 ${large} 1 ${o1.x} ${o1.y}`,
    `L ${i0.x} ${i0.y}`,
    `A ${r0} ${r0} 0 ${large} 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ')
}

/** A ribbon between two sub-arcs at radius `r`, bowed through the centre. */
export const ribbonPath = (cx: number, cy: number, r: number, ribbon: Ribbon): string => {
  const a0 = polar(cx, cy, r, ribbon.aStart)
  const a1 = polar(cx, cy, r, ribbon.aEnd)
  const b0 = polar(cx, cy, r, ribbon.bStart)
  const b1 = polar(cx, cy, r, ribbon.bEnd)
  const largeA = ribbon.aEnd - ribbon.aStart > Math.PI ? 1 : 0
  const largeB = ribbon.bEnd - ribbon.bStart > Math.PI ? 1 : 0
  return [
    `M ${a0.x} ${a0.y}`,
    `A ${r} ${r} 0 ${largeA} 1 ${a1.x} ${a1.y}`,
    `Q ${cx} ${cy} ${b0.x} ${b0.y}`,
    `A ${r} ${r} 0 ${largeB} 1 ${b1.x} ${b1.y}`,
    `Q ${cx} ${cy} ${a0.x} ${a0.y}`,
    'Z',
  ].join(' ')
}
