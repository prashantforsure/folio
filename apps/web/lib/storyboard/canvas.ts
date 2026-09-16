import type { ShotRow } from '@folio/contracts'

/**
 * The Storyboard canvas's geometry, pure and tested
 * (`tests/storyboard-canvas.test.ts`). The view (`_storyboard/canvas/`) owns
 * the DOM and the pointer; everything it needs to compute - where a card
 * goes when nobody has moved it, where a thread runs, what "fit" means,
 * which world point is under the cursor - is here, in world px.
 *
 * ## World and window
 *
 * The world is one `div` under a `translate(x, y) scale(k)`; a `Transform`
 * is those three numbers. A card's position is a world point: its stored
 * `canvasX` / `canvasY` (2026-09-17 ruling - persisted, cosmetic), or,
 * for a card nobody has moved, its place in the row `autoLayout` draws
 * from the sequence. The sequence itself is `order_key`, so the thread
 * from card N to card N+1 follows story order wherever the cards sit.
 *
 * ## Zoom is about a point
 *
 * `zoomAt` keeps the world point under the cursor fixed - the one property
 * a wheel zoom has to have - and `fitTransform` centres the content's
 * bounds at the largest scale, up to 100%, that shows all of it.
 */

/** A node's width. The height is measured; this is the floor the layout and the fit assume before a measure. */
export const NODE_W = 306
export const NODE_MIN_H = 380
/** The run between two nodes in the auto layout: room for the thread to curve. */
export const NODE_GAP = 72
/** Where the first auto-laid node sits: the mockup's strip padding. */
export const CANVAS_PAD = { x: 24, y: 28 } as const

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 2
/** The pill's stops, in percent. */
export const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200] as const

export type Point = { readonly x: number; readonly y: number }
export type Size = { readonly width: number; readonly height: number }
export type Rect = Point & Size
export type Transform = { readonly x: number; readonly y: number; readonly k: number }

export const IDENTITY: Transform = { x: 0, y: 0, k: 1 }

/** Where the card at `index` in the sequence sits when nobody has moved it. */
export const autoLayout = (index: number): Point => ({
  x: CANVAS_PAD.x + index * (NODE_W + NODE_GAP),
  y: CANVAS_PAD.y,
})

/** The stored position, else the auto layout. Both-or-neither is the schema's check; either null means auto. */
export const nodePosition = (shot: Pick<ShotRow, 'canvasX' | 'canvasY'>, index: number): Point =>
  shot.canvasX === null || shot.canvasY === null ? autoLayout(index) : { x: shot.canvasX, y: shot.canvasY }

/** A thread leaves the right edge of `a`, mid-height, and arrives at the left edge of `b`, mid-height. */
export const connectorEnds = (a: Rect, b: Rect): { readonly from: Point; readonly to: Point } => ({
  from: { x: a.x + a.width, y: a.y + a.height / 2 },
  to: { x: b.x, y: b.y + b.height / 2 },
})

const round = (value: number): string => String(Math.round(value * 100) / 100)

/**
 * The thread's path: a cubic whose handles reach horizontally, half the
 * run apart and never less than 40px, so a card dragged behind its
 * predecessor still gets a readable S rather than a straight line.
 */
export const connectorPath = (a: Rect, b: Rect): string => {
  const { from, to } = connectorEnds(a, b)
  const dx = Math.max(40, Math.abs(to.x - from.x) / 2)
  return `M ${round(from.x)} ${round(from.y)} C ${round(from.x + dx)} ${round(from.y)}, ${round(to.x - dx)} ${round(to.y)}, ${round(to.x)} ${round(to.y)}`
}

/** The box around every rect, or null for none. */
export const boundsOf = (rects: readonly Rect[]): Rect | null => {
  const first = rects[0]
  if (first === undefined) return null
  let left = first.x
  let top = first.y
  let right = first.x + first.width
  let bottom = first.y + first.height
  for (const rect of rects) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export const clampZoom = (k: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k))

/**
 * Scale by `factor` about `cursor` (a point in window px, relative to the
 * ground's top-left) so the world point under the cursor stays put.
 */
export const zoomAt = (t: Transform, cursor: Point, factor: number): Transform => {
  const k = clampZoom(t.k * factor)
  const ratio = k / t.k
  return {
    x: cursor.x - (cursor.x - t.x) * ratio,
    y: cursor.y - (cursor.y - t.y) * ratio,
    k,
  }
}

/** The transform that shows all of `bounds` in `viewport`, centred, at the largest scale up to 100%. */
export const fitTransform = (bounds: Rect, viewport: Size, pad = 40): Transform => {
  const usable = { width: Math.max(1, viewport.width - pad * 2), height: Math.max(1, viewport.height - pad * 2) }
  const k = clampZoom(Math.min(1, usable.width / Math.max(1, bounds.width), usable.height / Math.max(1, bounds.height)))
  return {
    x: (viewport.width - bounds.width * k) / 2 - bounds.x * k,
    y: (viewport.height - bounds.height * k) / 2 - bounds.y * k,
    k,
  }
}

/** The world point under a window point, given where the ground's top-left is in the window. */
export const worldFromClient = (t: Transform, client: Point, groundOrigin: Point): Point => ({
  x: (client.x - groundOrigin.x - t.x) / t.k,
  y: (client.y - groundOrigin.y - t.y) / t.k,
})

/** The pill's next stop from `k`, in the given direction, as a scale. At an end, `k` itself. */
export const nextZoomStep = (k: number, direction: 1 | -1): number => {
  const percent = Math.round(k * 100)
  const next =
    direction === 1 ? ZOOM_STEPS.find((step) => step > percent) : [...ZOOM_STEPS].reverse().find((step) => step < percent)
  return next === undefined ? k : next / 100
}

/** `100%`. */
export const zoomLabel = (k: number): string => `${String(Math.round(k * 100))}%`
