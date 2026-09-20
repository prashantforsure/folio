'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useRef } from 'react'

import type { Point } from '../../../../../../../lib/storyboard/canvas'

/**
 * A card's drag on a canvas: pointer capture on the grip, a 3px threshold
 * so a click stays a click, the delta divided by the world's scale, the
 * drop rounded to whole world px. Lifted from `_scenes/canvas/scene-node.tsx`
 * (2026-09-20) for the Characters canvas; the Storyboard's and Scenes'
 * nodes still carry their own copy (their comments ask for the move).
 *
 * `onDrag` fires with the live world position while the pointer moves and
 * `null` when it lifts; `onDrop` fires once, with the rounded point, only
 * when the pointer actually moved. The handlers go on the grip element;
 * `moved()` answers whether the last press was a drag, so a click handler
 * on the same element can tell the two apart.
 */
export const useNodeDrag = ({
  position,
  scale,
  onDrag,
  onDrop,
}: {
  readonly position: Point
  /** The world's scale, to turn a pointer delta into world px. */
  readonly scale: number
  readonly onDrag: (position: Point | null) => void
  readonly onDrop: (position: Point) => void
}) => {
  const drag = useRef<{ readonly pointerId: number; readonly startX: number; readonly startY: number; readonly from: Point; moved: boolean } | null>(null)
  const last = useRef(false)

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: position, moved: false }
    last.current = false
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = drag.current
    if (current === null || event.pointerId !== current.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < 3) return
    current.moved = true
    last.current = true
    onDrag({ x: current.from.x + dx / scale, y: current.from.y + dy / scale })
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
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

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    /** Whether the last press moved the card - read in a click handler to skip the click after a drag. */
    moved: (): boolean => last.current,
  }
}
