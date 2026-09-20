'use client'

import type { RefObject } from 'react'
import { useLayoutEffect } from 'react'

import type { Size } from '../../../../../../../lib/storyboard/canvas'

/**
 * Report an element's rendered size, once on mount and on every resize
 * (`ResizeObserver`), so a canvas can lay threads to a card's true edges
 * and fit its true bounds. Lifted from `_scenes/canvas/scene-node.tsx`
 * (2026-09-20). A layout effect: the first measure lands before paint.
 */
export const useMeasure = (root: RefObject<HTMLElement | null>, onMeasure: (size: Size) => void): void => {
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
  }, [onMeasure, root])
}
