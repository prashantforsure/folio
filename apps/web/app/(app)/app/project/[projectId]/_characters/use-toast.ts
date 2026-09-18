'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { StatusToast } from '../_chrome/status-bar'

/** How long an act that can be taken back stays takeable-back in the status bar. */
export const TOAST_MS = 8000

/**
 * The status bar's toast: a line and, usually, an `Undo`, for a few
 * seconds after a queue decision or a rename. One at a time - a new one
 * replaces the old and restarts the clock; the timer is cleared on
 * unmount. Moves to `_chrome/` when a second route needs it.
 */
export const useToast = (): {
  readonly toast: StatusToast | null
  readonly show: (message: string, action?: StatusToast['action'], ttl?: number) => void
  readonly clear: () => void
} => {
  const [toast, setToast] = useState<StatusToast | null>(null)
  const timer = useRef<number | null>(null)

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    setToast(null)
  }, [])

  const show = useCallback(
    (message: string, action?: StatusToast['action'], ttl: number = TOAST_MS) => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      setToast(action === undefined ? { message } : { message, action })
      timer.current = window.setTimeout(() => {
        timer.current = null
        setToast(null)
      }, ttl)
    },
    [],
  )

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  return { toast, show, clear }
}
