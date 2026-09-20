'use client'

import type { CastFigure } from '../../../../../../../lib/characters/cast'
import type { Point } from '../../../../../../../lib/storyboard/canvas'
import { useNodeDrag } from '../../_chrome/canvas/use-node-drag'

/**
 * One tile of the Relationships graph: the 72×66 colour block in the
 * record's gradient (or its portrait) with the name pill under it,
 * centred on `position`. A drag moves the tile (pointer capture, the 3px
 * threshold, no scale - the graph's ground does not zoom) and the view
 * keeps the point as an override until `Relayout`; a click opens the
 * drawer. Hover and focus tell the view (`onHover`) so the edges can light
 * (2026-09-21); `dim` is the view saying another tile is the active one.
 */
export const GraphNode = ({
  figure,
  position,
  selected,
  dim,
  onOpen,
  onHover,
  onDrag,
  onDrop,
}: {
  readonly figure: CastFigure
  /** The tile's centre. */
  readonly position: Point
  readonly selected: boolean
  /** Another tile is active; this one steps back. */
  readonly dim: boolean
  readonly onOpen: () => void
  /** The pointer or focus arrived (`true`) or left (`false`). */
  readonly onHover: (over: boolean) => void
  readonly onDrag: (position: Point | null) => void
  readonly onDrop: (position: Point) => void
}) => {
  const drag = useNodeDrag({ position, scale: 1, onDrag, onDrop })
  return (
    <div
      role="button"
      tabIndex={0}
      data-graph-node={figure.id}
      data-selected={selected ? 'true' : 'false'}
      data-dim={dim ? 'true' : undefined}
      data-graph-x={Math.round(position.x)}
      data-graph-y={Math.round(position.y)}
      aria-label={`Open ${figure.name}`}
      className="folio-graph-node"
      style={{ left: position.x, top: position.y, ['--cast-h' as string]: `var(--chip-${String(figure.hue)}-h)` }}
      {...drag.handlers}
      onPointerEnter={() => {
        onHover(true)
      }}
      onPointerLeave={() => {
        onHover(false)
      }}
      onFocus={() => {
        onHover(true)
      }}
      onBlur={() => {
        onHover(false)
      }}
      onClick={() => {
        if (!drag.moved()) onOpen()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span>{figure.portraitUrl === null ? null : <img src={figure.portraitUrl} alt="" draggable={false} />}</span>
      <span className="folio-graph-name" data-graph-name>
        {figure.name}
      </span>
    </div>
  )
}
