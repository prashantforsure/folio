'use client'

import type { Relationship } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { CastFigure } from '../../../../../../../lib/characters/cast'
import { GRAPH_LAYOUTS, authoredEdges, circleLayout, forceLayout } from '../../../../../../../lib/characters/graph'
import type { DialogueEdge, GraphEdge, GraphLayout, GraphNode as GraphNodeData } from '../../../../../../../lib/characters/graph'
import type { Point, Size } from '../../../../../../../lib/storyboard/canvas'
import { ViewPill } from '../../_chrome/view-pill'
import { GraphEdges } from './graph-edges'
import { GraphNode } from './graph-node'

/**
 * The Relationships view (2026-09-20, ruling 1 - the graph laper.ai draws,
 * back in place of the Presence grid): every character as a 72×90 tile on
 * a static dotted ground, the authored relationships as dashed edges with
 * a label at each end, and a `Force · Dialogue · Chord` pill bottom-centre.
 *
 * ## Laid out once, by arithmetic
 *
 * `forceLayout` runs synchronously to a fixed count over the tiles and
 * whichever edges the layout reads - the authored rows for `Force`, the
 * derivation's exchanges for `Dialogue` - and `circleLayout` puts the cast
 * in a ring for `Chord`. All three are pure functions of the rows and the
 * ground's size (measured, re-run on resize), so switching is instant,
 * leaving and coming back draws the same picture, and nothing moves on
 * its own. A tile the writer drags keeps its point (`overrides`) until
 * `Relayout`, which is drawn only while there is something to relayout.
 *
 * Tile click → the drawer; label click → the relationship modal. With no
 * relationship the view says where to make one. The tile under the pointer
 * or holding focus (`hover`), else the selected one, is the active tile
 * (2026-09-21): its edges light in accent, the rest step back. `data-sub-view` is the
 * workspace's; this draws `data-relationships-view` and `data-layout-pill`.
 */
const EMPTY = "No relationships yet — drag a card's handle onto another on the Canvas, or open a character and add one."
const NO_DIALOGUE = 'No two characters exchange lines on the page yet.'

export const RelationshipsView = ({
  figures,
  relationships,
  dialogue,
  selected,
  onOpen,
  onEditRelationship,
}: {
  readonly figures: readonly CastFigure[]
  readonly relationships: readonly Relationship[]
  readonly dialogue: readonly DialogueEdge[]
  readonly selected: CharacterId | null
  readonly onOpen: (id: CharacterId) => void
  readonly onEditRelationship: (edge: GraphEdge) => void
}) => {
  const ground = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [layout, setLayout] = useState<GraphLayout>('force')
  const [overrides, setOverrides] = useState<ReadonlyMap<CharacterId, Point>>(new Map())
  const [dragging, setDragging] = useState<{ readonly id: CharacterId; readonly position: Point } | null>(null)
  const [hover, setHover] = useState<CharacterId | null>(null)
  const active = hover ?? selected

  useLayoutEffect(() => {
    const node = ground.current
    if (node === null) return undefined
    const measure = (): void => {
      setSize({ width: node.clientWidth, height: node.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])

  const nodes = useMemo<readonly GraphNodeData[]>(() => figures.map((figure) => ({ id: figure.id, name: figure.name, hue: figure.hue })), [figures])
  const authored = useMemo(() => authoredEdges(relationships), [relationships])
  /** The active tile and its neighbours; every other tile is dimmed. */
  const near = useMemo(() => {
    const out = new Set<CharacterId>()
    if (active === null) return out
    out.add(active)
    for (const edge of layout === 'dialogue' ? dialogue : authored) {
      if (edge.a === active) out.add(edge.b)
      if (edge.b === active) out.add(edge.a)
    }
    return out
  }, [active, authored, dialogue, layout])
  const laid = useMemo(() => {
    if (size.width === 0 || size.height === 0) return new Map<CharacterId, Point>()
    if (layout === 'chord') return circleLayout(nodes, size)
    return forceLayout(nodes, layout === 'dialogue' ? dialogue : authored, size)
  }, [authored, dialogue, layout, nodes, size])
  const positions = useMemo(() => {
    const out = new Map<CharacterId, Point>(laid)
    for (const [id, point] of overrides) if (out.has(id)) out.set(id, point)
    if (dragging !== null && out.has(dragging.id)) out.set(dragging.id, dragging.position)
    return out
  }, [dragging, laid, overrides])

  const edgesShown = layout === 'dialogue' ? dialogue.length : authored.length

  return (
    <div data-relationships-view data-layout={layout} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={ground} data-canvas-ground data-static className="folio-canvas-ground min-h-0 flex-1">
        {size.width === 0 ? null : (
          <>
            <GraphEdges layout={layout} positions={positions} size={size} authored={authored} dialogue={dialogue} active={active} onEdit={onEditRelationship} />
            {figures.map((figure) => {
              const position = positions.get(figure.id)
              if (position === undefined) return null
              return (
                <GraphNode
                  key={figure.id}
                  figure={figure}
                  position={position}
                  selected={selected === figure.id}
                  dim={active !== null && !near.has(figure.id)}
                  onOpen={() => {
                    onOpen(figure.id)
                  }}
                  onHover={(over) => {
                    setHover((current) => (over ? figure.id : current === figure.id ? null : current))
                  }}
                  onDrag={(point) => {
                    setDragging(point === null ? null : { id: figure.id, position: point })
                  }}
                  onDrop={(point) => {
                    setDragging(null)
                    setOverrides((current) => {
                      const next = new Map(current)
                      next.set(figure.id, point)
                      return next
                    })
                  }}
                />
              )
            })}
          </>
        )}
        {edgesShown === 0 ? (
          <p data-graph-empty className="pointer-events-none absolute left-1/2 top-[18px] m-0 max-w-[520px] -translate-x-1/2 text-center text-12-5 leading-[1.5] text-ink3" style={{ textWrap: 'pretty' }}>
            {layout === 'dialogue' ? NO_DIALOGUE : EMPTY}
          </p>
        ) : null}
      </div>

      <div data-layout-pill className="absolute bottom-[18px] left-1/2 flex -translate-x-1/2 items-center gap-[8px]">
        <ViewPill label="Layout" items={GRAPH_LAYOUTS} current={layout} onSelect={setLayout} />
        {overrides.size === 0 ? null : (
          <button
            type="button"
            data-relayout
            title="Put every tile back where the layout has it"
            onClick={() => {
              setOverrides(new Map())
            }}
            className="folio-pill-button h-[34px] rounded-[10px] px-[12px] text-12-5"
          >
            Relayout
          </button>
        )}
      </div>
    </div>
  )
}
