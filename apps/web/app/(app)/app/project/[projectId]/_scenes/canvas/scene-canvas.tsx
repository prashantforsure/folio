'use client'

import type { ProjectId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { SCENE_NODE_MIN_H, SCENE_NODE_W, openingWindow, scenePosition } from '../../../../../../../lib/scenes/canvas'
import type { ScenePositions } from '../../../../../../../lib/scenes/canvas'
import type { SceneCard } from '../../../../../../../lib/scenes/server'
import { ZOOM_MAX, ZOOM_MIN, boundsOf, zoomLabel } from '../../../../../../../lib/storyboard/canvas'
import type { Point, Rect, Size } from '../../../../../../../lib/storyboard/canvas'
import type { EpisodeRoutePath } from '../../../../../../../lib/workspace/hrefs'
import { Connectors } from '../../_storyboard/canvas/connectors'
import { useCanvasViewport } from '../../_storyboard/canvas/use-canvas-viewport'
import { SceneNode } from './scene-node'

/**
 * The Cards view as a canvas (2026-09-17): every scene of the episode as a
 * node on a free ground - pan, zoom, drag anywhere - threaded in story
 * order. The Storyboard's canvas with a scene per card; the ruling and its
 * record are "Redesign phase 8" in `docs/build-decisions.md`.
 *
 * ## Shared, not copied
 *
 * The viewport (pan by pointer capture, zoom by ctrl/cmd + wheel, the
 * `Space` pan, the fit), the threads and the geometry are the Storyboard's
 * modules, imported across the route boundary rather than duplicated:
 * one canvas, two routes. They belong in `_chrome/canvas/` and
 * `lib/workspace/canvas.ts`; the move waits on the Storyboard pass that is
 * in flight beside this one, so its files are not edited from here.
 *
 * ## Where a card sits, and for how long
 *
 * `scenePosition`: the point the writer dragged it to this session, else
 * its place in the sequence row. Positions are this component's state -
 * `scenes` has no `canvas_x` yet (the pure module says why) - so they
 * survive a synopsis save (the workspace stays mounted) and not a reload.
 * Heights are measured (each card reports its size) so a thread meets a
 * card's true mid-edge and the fit sees the true bounds.
 *
 * ## Opening on the start of the row
 *
 * A fit of forty scenes is the minimum zoom with nothing readable, so the
 * canvas opens on `openingWindow` - the first cards at 100% from the left
 * - once, when the document mounts. The pill's `Fit` fits everything,
 * which is what it says.
 */
export const SceneCanvas = ({
  projectId,
  scenes,
  synopsisOf,
  selected,
  productionHref,
  onSelect,
  onEdit,
  onRead,
}: {
  readonly projectId: ProjectId
  readonly scenes: readonly SceneCard[]
  readonly synopsisOf: (card: SceneCard) => string | null
  readonly selected: NodeId | null
  readonly productionHref: EpisodeRoutePath
  readonly onSelect: (id: NodeId) => void
  readonly onEdit: (id: NodeId, focus: boolean) => void
  readonly onRead: (id: NodeId) => void
}) => {
  const ground = useRef<HTMLDivElement>(null)
  const viewport = useCanvasViewport(ground)
  const [positions, setPositions] = useState<ScenePositions>(new Map())
  const [sizes, setSizes] = useState<ReadonlyMap<NodeId, Size>>(new Map())
  const [dragging, setDragging] = useState<{ readonly id: NodeId; readonly position: Point } | null>(null)

  const rects = useMemo(
    () =>
      scenes.map((card, index) => {
        const id = card.derived.sceneNodeId
        const stored = scenePosition(positions, id, index)
        const position = dragging !== null && dragging.id === id ? dragging.position : stored
        const size = sizes.get(id) ?? { width: SCENE_NODE_W, height: SCENE_NODE_MIN_H }
        const rect: Rect = { x: position.x, y: position.y, width: size.width, height: size.height }
        return { id, rect }
      }),
    [dragging, positions, scenes, sizes],
  )

  // The latest bounds, for a fit that fires once rather than on every measure.
  // A layout effect, so the first client paint is already placed rather than identity then placed.
  const bounds = useRef<Rect | null>(null)
  bounds.current = boundsOf(rects.map((entry) => entry.rect))
  const { fit } = viewport
  useLayoutEffect(() => {
    const node = ground.current
    const current = bounds.current
    if (node === null || current === null) return
    fit(openingWindow(current, { width: node.clientWidth, height: node.clientHeight }))
  }, [fit])

  const measure = useCallback((id: NodeId, size: Size) => {
    setSizes((current) => {
      const known = current.get(id)
      if (known !== undefined && known.width === size.width && known.height === size.height) return current
      const next = new Map(current)
      next.set(id, size)
      return next
    })
  }, [])
  const measurers = useMemo(
    () => new Map(scenes.map((card) => [card.derived.sceneNodeId, (size: Size) => measure(card.derived.sceneNodeId, size)])),
    [measure, scenes],
  )

  const { transform, panning } = viewport

  return (
    <div data-scene-canvas className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
          <Connectors rects={rects} />
          {scenes.map((card, index) => {
            const id = card.derived.sceneNodeId
            const entry = rects[index]
            const onMeasure = measurers.get(id)
            if (entry === undefined || onMeasure === undefined) return null
            return (
              <SceneNode
                key={id}
                projectId={projectId}
                card={card}
                synopsis={synopsisOf(card)}
                position={{ x: entry.rect.x, y: entry.rect.y }}
                scale={transform.k}
                selected={selected === id}
                dragging={dragging?.id === id}
                productionHref={productionHref}
                onSelect={() => {
                  onSelect(id)
                }}
                onEdit={(focus) => {
                  onEdit(id, focus)
                }}
                onRead={() => {
                  onRead(id)
                }}
                onDrag={(position) => {
                  setDragging(position === null ? null : { id, position })
                }}
                onDrop={(position) => {
                  setDragging(null)
                  setPositions((current) => {
                    const next = new Map(current)
                    next.set(id, position)
                    return next
                  })
                }}
                onMeasure={onMeasure}
              />
            )
          })}
        </div>
      </div>

      <div data-zoom-pill className="absolute bottom-[18px] left-[20px] flex items-center gap-[2px] rounded-pill border border-line bg-sunk p-[4px] shadow-[0_12px_34px_var(--shade)]">
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={transform.k <= ZOOM_MIN}
          className="folio-ghost-button grid h-[30px] w-[30px] place-items-center rounded-full text-15 leading-none text-ink2 disabled:opacity-40"
          onClick={() => {
            viewport.zoomStep(-1)
          }}
        >
          −
        </button>
        <span className="tabular min-w-[48px] text-center font-mono text-11-5 text-ink2" data-zoom-label>
          {zoomLabel(transform.k)}
        </span>
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={transform.k >= ZOOM_MAX}
          className="folio-ghost-button grid h-[30px] w-[30px] place-items-center rounded-full text-15 leading-none text-ink2 disabled:opacity-40"
          onClick={() => {
            viewport.zoomStep(1)
          }}
        >
          +
        </button>
        <span className="mx-[3px] h-[18px] w-[1px] bg-line" />
        <button
          type="button"
          data-zoom-fit
          title="Fit every scene in the window"
          className="folio-ghost-button h-[30px] rounded-pill px-[11px] text-12-5 text-ink2"
          onClick={() => {
            fit(bounds.current)
          }}
        >
          Fit
        </button>
      </div>
    </div>
  )
}
