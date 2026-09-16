'use client'

import { Icon } from '@folio/ui'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { sceneNo, sceneSlug } from '../../../../../../../lib/storyboard/board'
import { NODE_MIN_H, NODE_W, ZOOM_MAX, ZOOM_MIN, boundsOf, nodePosition, zoomLabel } from '../../../../../../../lib/storyboard/canvas'
import type { Point, Rect, Size } from '../../../../../../../lib/storyboard/canvas'
import type { ViewProps } from '../handlers'
import { BLANK_SHOT, NoShots } from '../shot-parts'
import { Connectors } from './connectors'
import { ShotNode } from './shot-node'
import { useCanvasViewport } from './use-canvas-viewport'

/**
 * The canvas (2026-09-17): the selected scene's shots as cards on a free
 * ground - pan, zoom, drag anywhere - threaded in story order. Replaces
 * the mockup's strip; the ruling and its record are "Redesign phase 3,
 * second pass" in `docs/build-decisions.md`.
 *
 * ## One scene at a time
 *
 * As the strip was. Every write is per scene and every thread is one
 * scene's sequence; the toolbar's stepper, the sidebar's `Boards` group
 * and the board's `Open` pick which. The count in the route's toolbar
 * names it.
 *
 * ## Where a card sits
 *
 * `nodePosition`: its stored `canvasX` / `canvasY`, else its place in the
 * auto-laid row. While a card drags, the view overlays the pointer's
 * position (`dragging`) so the threads follow live; on release the card's
 * `onDrop` writes it through `onPlaceOnCanvas`, optimistically. Heights
 * are measured (each card reports its size) so a thread meets a card's
 * true mid-edge and `Fit` sees the true bounds.
 *
 * ## The ground
 *
 * `useCanvasViewport` owns the transform; the dotted grid is redrawn under
 * it so the dots pan and scale with the world, which is what makes the
 * world feel like a surface. Fit runs when the scene changes.
 */

export const CanvasView = ({ view }: { readonly view: ViewProps }) => {
  const ground = useRef<HTMLDivElement>(null)
  const viewport = useCanvasViewport(ground)
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map())
  const [dragging, setDragging] = useState<{ readonly id: string; readonly position: Point } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const sceneIndex = view.scenes.findIndex((entry) => entry.sceneNodeId === view.selected)
  const scene = sceneIndex === -1 ? null : (view.scenes[sceneIndex] ?? null)
  const shots = useMemo(() => (scene === null ? [] : scene.shots.filter(view.visible)), [scene, view.visible])

  const rects = useMemo(
    () =>
      shots.map((shot, index) => {
        const stored = nodePosition(shot, index)
        const position = dragging !== null && dragging.id === shot.id ? dragging.position : stored
        const size = sizes.get(shot.id) ?? { width: NODE_W, height: NODE_MIN_H }
        const rect: Rect = { x: position.x, y: position.y, width: size.width, height: size.height }
        return { id: shot.id, rect }
      }),
    [dragging, shots, sizes],
  )

  // The latest bounds, for a fit that fires on a scene change rather than on every measure.
  // A layout effect, so the first client paint is already fitted rather than identity then fitted.
  const bounds = useRef<Rect | null>(null)
  bounds.current = boundsOf(rects.map((entry) => entry.rect))
  const { fit } = viewport
  const sceneNodeId = scene?.sceneNodeId ?? null
  useLayoutEffect(() => {
    fit(bounds.current)
  }, [fit, sceneNodeId])

  const measure = useCallback((id: string, size: Size) => {
    setSizes((current) => {
      const known = current.get(id)
      if (known !== undefined && known.width === size.width && known.height === size.height) return current
      const next = new Map(current)
      next.set(id, size)
      return next
    })
  }, [])
  const measurers = useMemo(() => new Map(shots.map((shot) => [shot.id, (size: Size) => measure(shot.id, size)])), [measure, shots])

  const step = (direction: 1 | -1): void => {
    const next = view.scenes[sceneIndex + direction]
    if (next !== undefined) view.onSelect(next.sceneNodeId)
  }

  const { transform, panning } = viewport

  return (
    <div data-shot-canvas className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-[10px] border-t border-line2 px-[20px] py-[8px]">
        {scene === null ? null : (
          <div data-scene-stepper className="flex items-center gap-[4px]">
            <button
              type="button"
              title="Previous scene"
              aria-label="Previous scene"
              data-scene-step="prev"
              disabled={sceneIndex <= 0}
              className="folio-ghost-button grid h-[28px] w-[28px] place-items-center rounded-full text-ink2 disabled:opacity-40"
              onClick={() => {
                step(-1)
              }}
            >
              <Icon name="chevron" size={11} strokeWidth={1.5} style={{ transform: 'rotate(90deg)' }} />
            </button>
            <span className="flex items-baseline gap-[8px] px-[4px]">
              <span className="text-13-5 font-medium">Scene {sceneNo(scene.number)}</span>
              <span className="truncate font-mono text-11 text-ink3">{sceneSlug(scene)}</span>
            </span>
            <button
              type="button"
              title="Next scene"
              aria-label="Next scene"
              data-scene-step="next"
              disabled={sceneIndex >= view.scenes.length - 1}
              className="folio-ghost-button grid h-[28px] w-[28px] place-items-center rounded-full text-ink2 disabled:opacity-40"
              onClick={() => {
                step(1)
              }}
            >
              <Icon name="chevron" size={11} strokeWidth={1.5} style={{ transform: 'rotate(-90deg)' }} />
            </button>
          </div>
        )}
        <div className="flex-1" />
        {scene !== null && scene.shots.length > 0 ? (
          <button
            type="button"
            data-auto-board
            disabled={view.pending}
            title="Propose shots for this scene from the script. A proposal still waiting is replaced."
            className="folio-pill-button h-[32px] rounded-[10px] px-[12px] text-12-5 disabled:opacity-60"
            onClick={() => {
              view.handlers.onPropose(scene.sceneNodeId)
            }}
          >
            Auto board
          </button>
        ) : null}
        {scene === null ? null : (
          <button
            type="button"
            data-add-shot
            disabled={view.pending}
            className="folio-solid-button h-[32px] rounded-[10px] px-[12px] text-12-5 font-medium disabled:opacity-60"
            onClick={() => {
              view.handlers.onAdd(scene.sceneNodeId, BLANK_SHOT)
            }}
          >
            + Add shot
          </button>
        )}
      </div>

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
        {scene === null ? (
          <p className="pointer-events-none m-0 p-[28px] text-12-5 text-ink3">Pick a scene in the sidebar to open its canvas.</p>
        ) : scene.shots.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <NoShots
              pending={view.pending}
              onPropose={() => {
                view.handlers.onPropose(scene.sceneNodeId)
              }}
            />
          </div>
        ) : (
          <div
            data-canvas-world
            className="folio-canvas-world"
            style={{ transform: `translate(${String(transform.x)}px, ${String(transform.y)}px) scale(${String(transform.k)})` }}
          >
            {shots.length === 0 ? <p className="pointer-events-none m-0 whitespace-nowrap p-[28px] text-12-5 text-ink3">No shots match this filter.</p> : null}
            <Connectors rects={rects} />
            {shots.map((shot, index) => {
              const entry = rects[index]
              const onMeasure = measurers.get(shot.id)
              if (entry === undefined || onMeasure === undefined) return null
              return (
                <ShotNode
                  key={shot.id}
                  shot={shot}
                  scene={scene}
                  index={index}
                  count={scene.shots.length}
                  view={view}
                  position={{ x: entry.rect.x, y: entry.rect.y }}
                  scale={transform.k}
                  editing={editing === shot.id}
                  dragging={dragging?.id === shot.id}
                  onEdit={() => {
                    setEditing(shot.id)
                  }}
                  onClose={() => {
                    setEditing(null)
                  }}
                  onDrag={(position) => {
                    setDragging(position === null ? null : { id: shot.id, position })
                  }}
                  onDrop={(position) => {
                    setDragging(null)
                    view.handlers.onPlaceOnCanvas(shot.id, position)
                  }}
                  onMeasure={onMeasure}
                />
              )
            })}
          </div>
        )}
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
