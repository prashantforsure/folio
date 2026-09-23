'use client'

import type { ProjectId, Relationship } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { placeCharacterOnCanvas } from '../../../../../../../lib/characters/actions'
import { CHAR_NODE_MIN_H, CHAR_NODE_W, characterBounds, characterPositions, openingWindow } from '../../../../../../../lib/characters/canvas'
import type { CastFigure } from '../../../../../../../lib/characters/cast'
import type { CharacterLook } from '../../../../../../../lib/characters/server'
import { authoredEdges } from '../../../../../../../lib/characters/graph'
import type { GraphEdge } from '../../../../../../../lib/characters/graph'
import { worldFromClient } from '../../../../../../../lib/storyboard/canvas'
import type { Point, Rect, Size } from '../../../../../../../lib/storyboard/canvas'
import { ZoomPill } from '../../_chrome/canvas/zoom-pill'
import type { Run } from '../../_chrome/use-run'
import { useCanvasViewport } from '../../_storyboard/canvas/use-canvas-viewport'
import { CharacterNode } from './character-node'
import { RelationshipThreads } from './relationship-threads'

/**
 * The Canvas view (2026-09-20): every character as a card on a free ground
 * - pan, zoom, drag anywhere - with the authored relationships threaded
 * between them. The Storyboard's canvas with a person per card; the ruling
 * and its record are "Characters, fourth pass" in `docs/build-decisions.md`.
 *
 * ## Shared, not copied
 *
 * The viewport (pan by pointer capture, zoom by ctrl/cmd + wheel, the
 * `Space` pan, the fit) is the Storyboard's hook, imported across the
 * route boundary as Scenes imports it; the zoom pill, the node drag and
 * the measure are `_chrome/canvas/` (lifted this pass). The geometry is
 * `lib/characters/canvas.ts` and `lib/characters/graph.ts`.
 *
 * ## Where a card sits, and for how long
 *
 * `characterPositions`: the stored point (`characters.canvas_x / _y`,
 * `0024`, persisted on drop - ruling 3), else the first free grid cell in
 * cast order. A drop writes through `placeCharacterOnCanvas` and is held
 * here optimistically (`placed`) until the next read agrees; a card that
 * has never been moved needs no write to have a place, so `+ New
 * character` lands beside the last without one. Heights are measured so
 * a thread meets a card's true edge and the fit sees the true bounds.
 *
 * ## The connect drag
 *
 * A press on a card's four-dot grip starts a drag the view owns: the
 * pointer is tracked on the document (the grip cannot know which card it
 * is over), a live thread runs from the grip's card to the cursor, the
 * card under the pointer (`elementFromPoint`, up to `[data-character-node]`)
 * is marked `data-target`, and a release over another card hands the
 * pair to the workspace, which opens the relationship modal. A release
 * anywhere else is nothing.
 *
 * ## Opening on the first cards
 *
 * The canvas opens on `openingWindow` once, when it mounts - the first
 * cards at 100% from the left, or everything when it fits. `Fit` on the
 * pill fits everything, which is what it says.
 */
export const CharacterCanvas = ({
  projectId,
  figures,
  relationships,
  selected,
  storage,
  look,
  run,
  onOpen,
  onConnect,
  onEditRelationship,
  onUpload,
  onGenerate,
}: {
  readonly projectId: ProjectId
  /** Cast order: the order the grid fills in. */
  readonly figures: readonly CastFigure[]
  readonly relationships: readonly Relationship[]
  readonly selected: CharacterId | null
  readonly storage: boolean
  readonly look: CharacterLook
  readonly run: Run
  readonly onOpen: (id: CharacterId) => void
  /** A grip dropped on another card: the two records, grip's first. */
  readonly onConnect: (from: CharacterId, to: CharacterId) => void
  readonly onEditRelationship: (edge: GraphEdge) => void
  readonly onUpload: (id: CharacterId, file: File) => void
  /** `✦ Generate`: draw the character's look (roadmap task 5.2). */
  readonly onGenerate: (id: CharacterId) => void
}) => {
  const ground = useRef<HTMLDivElement>(null)
  const viewport = useCanvasViewport(ground)
  const [sizes, setSizes] = useState<ReadonlyMap<CharacterId, Size>>(new Map())
  const [placed, setPlaced] = useState<ReadonlyMap<CharacterId, Point>>(new Map())
  const [dragging, setDragging] = useState<{ readonly id: CharacterId; readonly position: Point } | null>(null)
  const [connect, setConnect] = useState<{ readonly from: CharacterId; readonly cursor: Point; readonly over: CharacterId | null } | null>(null)
  const { transform, panning, fit } = viewport

  // A stored point the server has since agreed with no longer needs holding.
  useEffect(() => {
    setPlaced((current) => {
      let next: Map<CharacterId, Point> | null = null
      for (const [id, point] of current) {
        const stored = figures.find((figure) => figure.id === id)?.canvas
        if (stored !== undefined && stored !== null && stored.x === point.x && stored.y === point.y) {
          next ??= new Map(current)
          next.delete(id)
        }
      }
      return next ?? current
    })
  }, [figures])

  const positions = useMemo(
    () => characterPositions(figures.map((figure) => ({ id: figure.id, canvas: placed.get(figure.id) ?? figure.canvas })), sizes),
    [figures, placed, sizes],
  )
  const rects = useMemo(() => {
    const out = new Map<CharacterId, Rect>()
    for (const figure of figures) {
      const stored = positions.get(figure.id) ?? { x: 0, y: 0 }
      const position = dragging !== null && dragging.id === figure.id ? dragging.position : stored
      const size = sizes.get(figure.id) ?? { width: CHAR_NODE_W, height: CHAR_NODE_MIN_H }
      out.set(figure.id, { x: position.x, y: position.y, width: size.width, height: size.height })
    }
    return out
  }, [dragging, figures, positions, sizes])
  const edges = useMemo(() => authoredEdges(relationships), [relationships])

  // The latest bounds, for a fit that fires once rather than on every measure.
  const bounds = useRef<Rect | null>(null)
  bounds.current = characterBounds(positions, sizes)
  useLayoutEffect(() => {
    const node = ground.current
    const current = bounds.current
    if (node === null || current === null) return
    fit(openingWindow(current, { width: node.clientWidth, height: node.clientHeight }))
  }, [fit])

  const measure = useCallback((id: CharacterId, size: Size) => {
    setSizes((current) => {
      const known = current.get(id)
      if (known !== undefined && known.width === size.width && known.height === size.height) return current
      const next = new Map(current)
      next.set(id, size)
      return next
    })
  }, [])
  const measurers = useMemo(() => new Map(figures.map((figure) => [figure.id, (size: Size) => measure(figure.id, size)])), [figures, measure])

  const drop = (id: CharacterId, position: Point): void => {
    setDragging(null)
    setPlaced((current) => {
      const next = new Map(current)
      next.set(id, position)
      return next
    })
    run(async () => {
      const result = await placeCharacterOnCanvas(projectId, id, position)
      return result.status === 'placed' ? null : result.message
    })
  }

  // The connect drag: tracked on the document from the grip's press to the release.
  const transformRef = useRef(transform)
  transformRef.current = transform
  const startConnect = (id: CharacterId, event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const node = ground.current
    if (node === null) return
    const origin = node.getBoundingClientRect()
    const toWorld = (client: Point): Point => worldFromClient(transformRef.current, client, { x: origin.left, y: origin.top })
    const overAt = (client: Point): CharacterId | null => {
      const hit = document.elementFromPoint(client.x, client.y)?.closest<HTMLElement>('[data-character-node]')
      const over = hit?.dataset['characterNode']
      return over === undefined || over === (id as string) ? null : (over as CharacterId)
    }
    const move = (pointer: PointerEvent): void => {
      const client = { x: pointer.clientX, y: pointer.clientY }
      setConnect({ from: id, cursor: toWorld(client), over: overAt(client) })
    }
    const end = (pointer: PointerEvent): void => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
      const over = overAt({ x: pointer.clientX, y: pointer.clientY })
      setConnect(null)
      if (over !== null) onConnect(id, over)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    setConnect({ from: id, cursor: toWorld({ x: event.clientX, y: event.clientY }), over: null })
  }

  return (
    <div data-character-canvas data-connecting={connect === null ? undefined : 'true'} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={ground}
        data-canvas-ground
        data-panning={panning ? 'true' : 'false'}
        data-zoom={Math.round(transform.k * 100)}
        className="folio-canvas-ground min-h-0 flex-1"
        style={{
          backgroundSize: `${String(24 * transform.k)}px ${String(24 * transform.k)}px`,
          backgroundPosition: `${String(transform.x + 12 * transform.k)}px ${String(transform.y + 12 * transform.k)}px`,
        }}
        onPointerDown={viewport.onPointerDown}
      >
        <div
          data-canvas-world
          className="folio-canvas-world"
          style={{ transform: `translate(${String(transform.x)}px, ${String(transform.y)}px) scale(${String(transform.k)})` }}
        >
          <RelationshipThreads rects={rects} edges={edges} live={connect === null ? null : { from: connect.from, cursor: connect.cursor }} onEdit={onEditRelationship} />
          {figures.map((figure) => {
            const rect = rects.get(figure.id)
            const onMeasure = measurers.get(figure.id)
            if (rect === undefined || onMeasure === undefined) return null
            return (
              <CharacterNode
                key={figure.id}
                figure={figure}
                position={{ x: rect.x, y: rect.y }}
                scale={transform.k}
                selected={selected === figure.id}
                dragging={dragging?.id === figure.id}
                target={connect?.over === figure.id}
                connecting={connect?.from === figure.id}
                storage={storage}
                look={{ cost: look.cost, off: look.off, drawing: look.drawing.includes(figure.id) }}
                onOpen={() => {
                  onOpen(figure.id)
                }}
                onDrag={(position) => {
                  setDragging(position === null ? null : { id: figure.id, position })
                }}
                onDrop={(position) => {
                  drop(figure.id, position)
                }}
                onMeasure={onMeasure}
                onConnectStart={(event) => {
                  startConnect(figure.id, event)
                }}
                onUpload={(file) => {
                  onUpload(figure.id, file)
                }}
                onGenerate={() => {
                  onGenerate(figure.id)
                }}
              />
            )
          })}
        </div>
      </div>

      <ZoomPill
        k={transform.k}
        position="top-right"
        fitTitle="Fit every character in the window"
        onZoom={viewport.zoomStep}
        onFit={() => {
          fit(bounds.current)
        }}
      />
    </div>
  )
}
