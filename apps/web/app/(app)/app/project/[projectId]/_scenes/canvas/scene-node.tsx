'use client'

import { Icon } from '@folio/ui'
import Link from 'next/link'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useLayoutEffect, useRef } from 'react'

import { SCENE_NODE_W, SCENE_STATUS_LABEL, sceneStatus, tileBadge } from '../../../../../../../lib/scenes/canvas'
import type { SceneCard } from '../../../../../../../lib/scenes/server'
import type { Point, Size } from '../../../../../../../lib/storyboard/canvas'
import { count } from '../../../../../../../lib/workspace/format'
import type { EpisodeRoutePath } from '../../../../../../../lib/workspace/hrefs'
import { CastChip, NO_SYNOPSIS, TileLines, eighthsLabel, hasSynopsis, pageLabel, sceneNo } from '../scene-parts'

/**
 * One scene on the canvas: a shot node's shape (`_storyboard/canvas/
 * shot-node.tsx`) with a scene's data in it. 306px, `--sunk`, the
 * `--shade` shadow; absolutely placed in the world at `position`, which
 * the view decides from the drag in flight and the positions it holds.
 *
 * ## Top to bottom
 *
 *   the grip       the status dot, `Scene 01`, and `Ready` / `Draft` in
 *                  mono where a shot prints its frame state. A drag here
 *                  moves the card (pointer capture, a 3px threshold so a
 *                  click stays a click); on release the view keeps the
 *                  point. Position is cosmetic: the thread and the number
 *                  follow the script's order.
 *   the heading    mono, uppercase, truncated, with `pg N` on the right -
 *                  the mockup card's second line.
 *   the tile       where a shot's frame sits: the scene's first lines,
 *                  inset by type, fading into the ground, `INT · DAWN` in
 *                  the corner where a shot prints `WS · 24mm`. The whole
 *                  tile is a button and opens the reading modal - the
 *                  client's ask, 2026-09-17.
 *   the counts     `2 chars` · `2 lines` · `4/8` as the shot's tag pills.
 *   the synopsis   three lines, or `No synopsis yet · write one`, which
 *                  opens the editor as the shot's `Describe the shot…` does.
 *   the cast       `@Name` chips, the mention chips' shape.
 *   the footer     `Edit` and `Go to Production`, two pill buttons where
 *                  the shot draws `Generate · N cr` and `⋯`.
 *
 * Every value printed is read from `SceneCard` (`lib/scenes/server.ts`),
 * which names the table each came from; nothing on the card is computed.
 */
export const SceneNode = ({
  card,
  synopsis,
  position,
  scale,
  selected,
  dragging,
  productionHref,
  onSelect,
  onEdit,
  onRead,
  onDrag,
  onDrop,
  onMeasure,
}: {
  readonly card: SceneCard
  /** The synopsis as the workspace knows it - the row's, or the one just saved. */
  readonly synopsis: string | null
  readonly position: Point
  /** The world's scale, to turn a pointer delta into world px. */
  readonly scale: number
  readonly selected: boolean
  readonly dragging: boolean
  readonly productionHref: EpisodeRoutePath
  readonly onSelect: () => void
  /** Open the detail dialog; `true` puts the caret in the synopsis editor. */
  readonly onEdit: (focus: boolean) => void
  readonly onRead: () => void
  /** The card is under the pointer at this world position; `null` when the drag ends. */
  readonly onDrag: (position: Point | null) => void
  readonly onDrop: (position: Point) => void
  readonly onMeasure: (size: Size) => void
}) => {
  const root = useRef<HTMLElement>(null)
  const drag = useRef<{ readonly pointerId: number; readonly startX: number; readonly startY: number; readonly from: Point; moved: boolean } | null>(null)

  const status = sceneStatus(synopsis)
  const badge = tileBadge(card.derived.reading)
  // The heading is the line above the tile; the tile opens on the scene's first line after it.
  const tileLines = card.excerpt.lines.slice(1)

  useLayoutEffect(() => {
    const node = root.current
    if (node === null) return undefined
    const measure = (): void => {
      onMeasure({ width: node.offsetWidth, height: node.offsetHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [onMeasure])

  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: position, moved: false }
  }
  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (current === null || event.pointerId !== current.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < 3) return
    current.moved = true
    onDrag({ x: current.from.x + dx / scale, y: current.from.y + dy / scale })
  }
  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (current === null || event.pointerId !== current.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!current.moved) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    onDrag(null)
    onDrop({ x: Math.round(current.from.x + dx / scale), y: Math.round(current.from.y + dy / scale) })
  }

  return (
    <article
      ref={root}
      data-scene-card={card.derived.sceneNodeId}
      data-scene-number={card.derived.number}
      data-scene-status={status}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : undefined}
      data-canvas-x={position.x}
      data-canvas-y={position.y}
      aria-label={`Scene ${sceneNo(card.derived.number)} · ${card.derived.heading}`}
      style={{ left: position.x, top: position.y, width: SCENE_NODE_W }}
      className="folio-scene-node absolute flex flex-col"
      onPointerDown={(event) => {
        // A press anywhere on the card is the card's, never the ground's pan.
        event.stopPropagation()
      }}
      onClick={onSelect}
    >
      <div
        data-node-grip
        className="folio-node-grip flex items-center gap-[9px] pb-[6px] pl-[12px] pr-[12px] pt-[11px]"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
      >
        <span className={`h-[7px] w-[7px] flex-none rounded-full ${status === 'ready' ? 'bg-ok' : 'bg-warn'}`} />
        <span className="min-w-0 flex-1 truncate text-13-5 font-medium">Scene {sceneNo(card.derived.number)}</span>
        <span className={`flex-none font-mono text-10-5 ${status === 'ready' ? 'text-ok' : 'text-warn'}`} data-node-state>
          {SCENE_STATUS_LABEL[status]}
        </span>
      </div>

      <div className="flex items-baseline gap-[8px] pb-[9px] pl-[12px] pr-[12px]">
        <span className="min-w-0 flex-1 truncate font-mono text-12 uppercase text-ink" data-scene-heading>
          {card.derived.heading}
        </span>
        <span className="tabular flex-none whitespace-nowrap font-mono text-10-5 text-ink3" data-scene-page>
          pg {pageLabel(card)}
        </span>
      </div>

      <div className="pl-[12px] pr-[12px]">
        <button
          type="button"
          data-scene-script
          title="Read the scene"
          aria-label={`Read scene ${sceneNo(card.derived.number)}`}
          className="folio-scene-tile"
          onClick={(event) => {
            event.stopPropagation()
            onRead()
          }}
        >
          <span className="flex flex-col gap-[1px]">
            {badge === null ? null : (
              <span className="mb-[5px] font-mono text-9-5 text-ink3" data-scene-badge>
                {badge}
              </span>
            )}
            {tileLines.length === 0 ? <span className="folio-scene-line text-ink3">The heading, and nothing under it yet.</span> : <TileLines lines={tileLines} />}
          </span>
          <span aria-hidden className="folio-scene-tile-fade" />
          <span aria-hidden className="folio-scene-tile-read">
            <Icon name="write" size={11} strokeWidth={1.5} />
            Read
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-[9px] pl-[12px] pr-[12px] pt-[11px]">
        <div className="flex flex-wrap gap-[5px]">
          <span title="Cast size" className="whitespace-nowrap rounded-pill border border-line2 bg-s1 px-[8px] py-[3px] text-11 text-ink2">
            {count(card.derived.castSize)} chars
          </span>
          <span title="Dialogue lines" className="whitespace-nowrap rounded-pill border border-line2 bg-s1 px-[8px] py-[3px] text-11 text-ink2">
            {count(card.derived.lines)} lines
          </span>
          <span title="Page eighths" className="tabular whitespace-nowrap rounded-pill border border-line2 bg-s1 px-[8px] py-[3px] font-mono text-11 text-ink2" data-scene-eighths>
            {eighthsLabel(card)}
          </span>
        </div>

        {hasSynopsis(synopsis) ? (
          <p className="folio-clamp-3 m-0 text-12-5 leading-[1.55] text-ink2" data-scene-synopsis>
            {synopsis}
          </p>
        ) : (
          <button
            type="button"
            data-scene-synopsis-empty
            className="m-0 w-full cursor-text border-0 bg-transparent p-0 text-left text-12-5 leading-[1.55] text-ink3 hover:text-ink2"
            onClick={(event) => {
              event.stopPropagation()
              onEdit(true)
            }}
          >
            {NO_SYNOPSIS}
          </button>
        )}

        {card.cast.length === 0 ? null : (
          <div className="flex flex-wrap gap-[6px]">
            {card.cast.map((member) => (
              <CastChip key={member.id} name={member.name} />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-[7px] p-[12px]">
        <button
          type="button"
          data-scene-edit
          className="folio-pill-button flex flex-1 items-center justify-center gap-[6px] rounded-[10px] px-[10px] py-[9px] text-12-5"
          onClick={(event) => {
            event.stopPropagation()
            onEdit(false)
          }}
        >
          <Icon name="write" size={13} strokeWidth={1.5} className="opacity-70" />
          Edit
        </button>
        <Link
          href={productionHref}
          data-scene-production
          className="folio-pill-button flex flex-1 items-center justify-center gap-[6px] whitespace-nowrap rounded-[10px] px-[10px] py-[9px] text-12-5 no-underline hover:no-underline"
          onClick={(event) => {
            event.stopPropagation()
          }}
        >
          <Icon name="production" size={14} strokeWidth={1.5} className="opacity-70" />
          Go to Production
        </Link>
      </div>
    </article>
  )
}
