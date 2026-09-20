'use client'

import type { CharacterId } from '@folio/script'

import { GRAPH_TILE, chordLabelAnchor, chordPath, edgeEnds, edgeLabelAnchor, strokeOf } from '../../../../../../../lib/characters/graph'
import type { DialogueEdge, GraphEdge, GraphLayout } from '../../../../../../../lib/characters/graph'
import { pairKey, pillLabels } from '../../../../../../../lib/characters/relationships'
import type { Point, Rect } from '../../../../../../../lib/storyboard/canvas'

/**
 * The graph's edges, in one SVG the size of the ground, under the tiles.
 *
 * An authored edge (`Force`, `Chord`) is a dashed `--ink3` line - static;
 * the canvas threads' dash is the route's one motion - from tile border
 * to tile border, with a label near each end: `mother` near the tile it
 * describes (t = 0.22 from `a`, `daughter` at 0.78), rotated along the
 * line and folded so it never reads upside down. Each label is a button
 * to the relationship modal. A `Chord` edge is bent through the centre
 * and its labels ride the curve.
 *
 * A dialogue edge (`Dialogue`) is a solid line whose width is the log of
 * the scenes the pair speaks in - the script's own answer, unlabelled.
 *
 * `active` (2026-09-21) is the tile the writer is on - hovered, focused or
 * selected: an edge touching it is drawn `data-on` (2px accent, its labels
 * accent), every other edge and label `data-dim`. With no active tile
 * every edge is at rest.
 */
const LABEL_T = { a: 0.22, b: 0.78 } as const

const rectOf = (centre: Point): Rect => ({ x: centre.x - GRAPH_TILE.width / 2, y: centre.y - GRAPH_TILE.height / 2, ...GRAPH_TILE })

const fmt = (value: number): string => String(Math.round(value * 100) / 100)

type Lit = { readonly on: boolean; readonly dim: boolean }
const litOf = (active: CharacterId | null, a: CharacterId, b: CharacterId): Lit => ({
  on: active !== null && (active === a || active === b),
  dim: active !== null && active !== a && active !== b,
})
const litAttrs = (lit: Lit): { readonly 'data-on': 'true' | undefined; readonly 'data-dim': 'true' | undefined } => ({
  'data-on': lit.on ? 'true' : undefined,
  'data-dim': lit.dim ? 'true' : undefined,
})

const Label = ({ anchor, text, edgeKey, side, lit, onEdit }: { readonly anchor: { readonly point: Point; readonly angle: number }; readonly text: string; readonly edgeKey: string; readonly side: 'a' | 'b'; readonly lit: Lit; readonly onEdit: () => void }) => (
  <text
    className="folio-edge-label"
    data-edge-label={side}
    data-edge-of={edgeKey}
    {...litAttrs(lit)}
    role="button"
    tabIndex={0}
    x={fmt(anchor.point.x)}
    y={fmt(anchor.point.y)}
    transform={`rotate(${fmt(anchor.angle)} ${fmt(anchor.point.x)} ${fmt(anchor.point.y)})`}
    onPointerDown={(event) => {
      event.stopPropagation()
    }}
    onClick={onEdit}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onEdit()
      }
    }}
  >
    {text}
  </text>
)

export const GraphEdges = ({
  layout,
  positions,
  size,
  authored,
  dialogue,
  active,
  onEdit,
}: {
  readonly layout: GraphLayout
  readonly positions: ReadonlyMap<CharacterId, Point>
  readonly size: { readonly width: number; readonly height: number }
  readonly authored: readonly GraphEdge[]
  readonly dialogue: readonly DialogueEdge[]
  /** The tile hovered, focused or selected; its edges light, the rest step back. */
  readonly active: CharacterId | null
  readonly onEdit: (edge: GraphEdge) => void
}) => {
  const centre = { x: size.width / 2, y: size.height / 2 }
  return (
    <svg className="absolute left-0 top-0" width={size.width} height={size.height} data-graph-edges={layout} aria-hidden={layout === 'dialogue' ? true : undefined}>
      {layout === 'dialogue'
        ? dialogue.flatMap((edge) => {
            const a = positions.get(edge.a)
            const b = positions.get(edge.b)
            if (a === undefined || b === undefined) return []
            const { from, to } = edgeEnds(rectOf(a), rectOf(b))
            const key = pairKey(edge.a, edge.b)
            return [
              <path
                key={key}
                className="folio-edge"
                data-edge={key}
                data-kind="dialogue"
                data-weight={edge.weight}
                {...litAttrs(litOf(active, edge.a, edge.b))}
                d={`M ${fmt(from.x)} ${fmt(from.y)} L ${fmt(to.x)} ${fmt(to.y)}`}
                style={{ strokeWidth: strokeOf(edge.weight) }}
              />,
            ]
          })
        : authored.flatMap((edge) => {
            const a = positions.get(edge.a)
            const b = positions.get(edge.b)
            if (a === undefined || b === undefined) return []
            const key = pairKey(edge.a, edge.b)
            const [aIs, bIs] = pillLabels(edge)
            const lit = litOf(active, edge.a, edge.b)
            const edit = (): void => {
              onEdit(edge)
            }
            if (layout === 'chord') {
              return [
                <g key={key}>
                  <path className="folio-edge" data-edge={key} data-kind="chord" {...litAttrs(lit)} d={chordPath(a, b, centre)} />
                  <Label anchor={chordLabelAnchor(a, b, centre, LABEL_T.a)} text={aIs} edgeKey={key} side="a" lit={lit} onEdit={edit} />
                  <Label anchor={chordLabelAnchor(a, b, centre, LABEL_T.b)} text={bIs} edgeKey={key} side="b" lit={lit} onEdit={edit} />
                </g>,
              ]
            }
            const { from, to } = edgeEnds(rectOf(a), rectOf(b))
            return [
              <g key={key}>
                <path className="folio-edge" data-edge={key} data-kind="authored" {...litAttrs(lit)} d={`M ${fmt(from.x)} ${fmt(from.y)} L ${fmt(to.x)} ${fmt(to.y)}`} />
                <Label anchor={edgeLabelAnchor(from, to, LABEL_T.a)} text={aIs} edgeKey={key} side="a" lit={lit} onEdit={edit} />
                <Label anchor={edgeLabelAnchor(from, to, LABEL_T.b)} text={bIs} edgeKey={key} side="b" lit={lit} onEdit={edit} />
              </g>,
            ]
          })}
    </svg>
  )
}
