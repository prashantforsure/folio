'use client'

import type { RefObject } from 'react'
import { useEffect } from 'react'

/**
 * Close a menu or popover on a click outside its root or on Escape. The
 * one hook every toolbar dropdown in the workspace shares - the Script's
 * and the Outline's toolbars each carried a copy until the Storyboard pass
 * (2026-09-16) needed a third.
 *
 * Listens only while `open`; the listeners come off when it closes or the
 * component unmounts.
 */
export const useDismiss = (open: boolean, close: () => void, root: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [close, open, root])
}
