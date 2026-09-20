'use client'

import type { CharacterId } from '@folio/script'
import { useState } from 'react'

import { bezierPoint, edgeCurve, edgePath } from '../../../../../../../lib/characters/graph'
import type { GraphEdge } from '../../../../../../../lib/characters/graph'
import { pairKey, pillLabels } from '../../../../../../../lib/characters/relationships'
import type { Point, Rect } from '../../../../../../../lib/storyboard/canvas'

/**
 * The authored relationships on the canvas (redrawn 2026-09-21): one thread
 * per row between the two cards - three strokes on one path, a blurred
 * `.folio-rel-thread-glow`, a `-rail`, and the moving dash on top (the
 * Storyboard's thread motion, ruled 2026-09-17, still under
 * `prefers-reduced-motion`), the dash's ink graded `--ink3` → `--ink` →
 * `--ink3` along the curve by a gradient per thread - and a two-label pill
 * at the curve's midpoint - `sister | brother` - that opens the relationship
 * for editing. Hovering or focusing the pill lights its thread (`data-lit`):
 * the dash and the glow turn accent. The SVG is in world space under the
 * cards, `overflow: visible`; the pills are HTML over it so they take a
 * click and a focus like any button. An edge whose card is not on the
 * canvas (a record merged since, in a stale read) draws nothing.
 *
 * `live` is the thread from a dragged grip to the cursor: the same three
 * strokes without the gradient, so the drag looks like the thing it will make.
 */
const gradientId = (key: string): string => `folio-rel-ink-${key.replace(/[^a-zA-Z0-9_-]/g, '')}`

const Thread = ({ d, lit, gradient }: { readonly d: string; readonly lit: boolean; readonly gradient: string | null }) => (
  <g data-lit={lit ? 'true' : 'false'}>
    <path className="folio-rel-thread-glow" d={d} />
    <path className="folio-rel-thread-rail" d={d} />
    <path className="folio-rel-thread" d={d} style={gradient === null || lit ? undefined : { stroke: `url(#${gradient})` }} />
  </g>
)

export const RelationshipThreads = ({
  rects,
  edges,
  live,
  onEdit,
}: {
  readonly rects: ReadonlyMap<CharacterId, Rect>
  readonly edges: readonly GraphEdge[]
  /** A connect-drag in flight: from this card's grip to this world point. */
  readonly live: { readonly from: CharacterId; readonly cursor: Point } | null
  readonly onEdit: (edge: GraphEdge) => void
}) => {
  const [lit, setLit] = useState<string | null>(null)
  const drawn = edges.flatMap((edge) => {
    const a = rects.get(edge.a)
    const b = rects.get(edge.b)
    return a === undefined || b === undefined ? [] : [{ edge, a, b, key: pairKey(edge.a, edge.b) }]
  })
  const origin = live === null ? undefined : rects.get(live.from)
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} data-threads>
        <defs>
          {drawn.map(({ a, b, key }) => {
            const curve = edgeCurve(a, b)
            const from = bezierPoint(curve, 0)
            const to = bezierPoint(curve, 1)
            return (
              <linearGradient key={key} id={gradientId(key)} gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
                <stop offset="0" style={{ stopColor: 'var(--ink3)' }} />
                <stop offset="0.5" style={{ stopColor: 'var(--ink)' }} />
                <stop offset="1" style={{ stopColor: 'var(--ink3)' }} />
              </linearGradient>
            )
          })}
        </defs>
        {drawn.map(({ a, b, key }) => (
          <g key={key} data-thread={key}>
            <Thread d={edgePath(a, b)} lit={lit === key} gradient={gradientId(key)} />
          </g>
        ))}
        {origin === undefined || live === null ? null : (
          <g data-thread-live>
            <Thread d={edgePath(origin, { x: live.cursor.x - 1, y: live.cursor.y - 1, width: 2, height: 2 }, 0)} lit={false} gradient={null} />
          </g>
        )}
      </svg>
      {drawn.map(({ edge, a, b, key }) => {
        const mid = bezierPoint(edgeCurve(a, b), 0.5)
        const [aIs, bIs] = pillLabels(edge)
        return (
          <button
            key={key}
            type="button"
            className="folio-edge-pill"
            data-thread-pill={key}
            data-lit={lit === key ? 'true' : 'false'}
            style={{ left: mid.x, top: mid.y }}
            title="Edit this relationship"
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onPointerEnter={() => {
              setLit(key)
            }}
            onPointerLeave={() => {
              setLit((current) => (current === key ? null : current))
            }}
            onFocus={() => {
              setLit(key)
            }}
            onBlur={() => {
              setLit((current) => (current === key ? null : current))
            }}
            onClick={(event) => {
              event.stopPropagation()
              onEdit(edge)
            }}
          >
            <span data-pill-a>{aIs}</span>
            <i aria-hidden />
            <span data-pill-b>{bIs}</span>
          </button>
        )
      })}
    </>
  )
}
