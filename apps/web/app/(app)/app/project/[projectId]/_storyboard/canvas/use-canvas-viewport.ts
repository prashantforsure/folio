'use client'

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { IDENTITY, clampZoom, fitTransform, nextZoomStep, zoomAt } from '../../../../../../../lib/storyboard/canvas'
import type { Rect, Transform } from '../../../../../../../lib/storyboard/canvas'

/**
 * The canvas's window over the world: one `Transform`, and the two ways a
 * pointer moves it.
 *
 * ## Pan
 *
 * A drag on the ground itself - empty ground with the primary button, or
 * any point with the middle button or Space held - pans. The ground takes
 * pointer capture so a fast drag that leaves it still pans, and reports
 * `panning` so the ground can say `grabbing`. A card's own drag is the
 * card's (`shot-node.tsx`) and never reaches here: it stops propagation.
 *
 * ## Wheel
 *
 * A plain wheel pans by the delta, both axes - a trackpad's two-finger
 * scroll. With Ctrl or Cmd it zooms about the cursor, which is also how a
 * trackpad pinch arrives in every browser. The listener is added by hand
 * with `passive: false`: React's `onWheel` is passive since React 17, so
 * `preventDefault` there is a no-op and the page would scroll too.
 *
 * ## Component state
 *
 * A zoom is a window's, as the strip's was (`lib/state/README.md`). `fit`
 * is called by the view when the scene changes or the writer asks.
 */

export type CanvasViewport = {
  readonly transform: Transform
  readonly panning: boolean
  readonly fit: (bounds: Rect | null) => void
  readonly zoomStep: (direction: 1 | -1) => void
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}

const ZOOM_WHEEL_RATE = 0.01

export const useCanvasViewport = (ground: RefObject<HTMLDivElement | null>): CanvasViewport => {
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const [panning, setPanning] = useState(false)
  const pan = useRef<{ readonly pointerId: number; readonly startX: number; readonly startY: number; readonly from: Transform } | null>(null)
  const space = useRef(false)

  // Space held turns a drag anywhere into a pan; tracked on the document so it is not lost to a focused card.
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !isTyping(event.target)) space.current = true
    }
    const up = (event: KeyboardEvent): void => {
      if (event.code === 'Space') space.current = false
    }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    const node = ground.current
    if (node === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        setTransform((current) => zoomAt(current, cursor, Math.exp(-event.deltaY * ZOOM_WHEEL_RATE)))
      } else {
        setTransform((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      node.removeEventListener('wheel', onWheel)
    }
  }, [ground])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const onGround = event.target === event.currentTarget
      const wantsPan = event.button === 1 || space.current || (event.button === 0 && onGround)
      if (!wantsPan) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      pan.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: transform }
      setPanning(true)
    },
    [transform],
  )

  useEffect(() => {
    const node = ground.current
    if (node === null) return undefined
    const move = (event: PointerEvent): void => {
      const current = pan.current
      if (current === null || event.pointerId !== current.pointerId) return
      setTransform({
        ...current.from,
        x: current.from.x + (event.clientX - current.startX),
        y: current.from.y + (event.clientY - current.startY),
      })
    }
    const end = (event: PointerEvent): void => {
      const current = pan.current
      if (current === null || event.pointerId !== current.pointerId) return
      pan.current = null
      setPanning(false)
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId)
    }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', end)
    node.addEventListener('pointercancel', end)
    return () => {
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', end)
      node.removeEventListener('pointercancel', end)
    }
  }, [ground])

  const fit = useCallback(
    (bounds: Rect | null) => {
      const node = ground.current
      if (node === null) return
      if (bounds === null) {
        setTransform(IDENTITY)
        return
      }
      setTransform(fitTransform(bounds, { width: node.clientWidth, height: node.clientHeight }))
    },
    [ground],
  )

  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const node = ground.current
      if (node === null) return
      // About the ground's centre, so the pill's zoom feels like the wheel's.
      const cursor = { x: node.clientWidth / 2, y: node.clientHeight / 2 }
      setTransform((current) => {
        const next = clampZoom(nextZoomStep(current.k, direction))
        return zoomAt(current, cursor, next / current.k)
      })
    },
    [ground],
  )

  return { transform, panning, fit, zoomStep, onPointerDown }
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
