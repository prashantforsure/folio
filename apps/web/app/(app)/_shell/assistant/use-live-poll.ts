'use client'

import { useEffect, useRef } from 'react'

/** D7's cadence for a background run: every two seconds while it is live. */
export const RUN_POLL_MS = 2_000

/**
 * Call `tick` every `ms` while `live` - the same shape as the routes'
 * `_chrome/polling.tsx`, for the panel, which re-reads a run rather than
 * refreshing the page (roadmap task 4.4, ADR 0003 D7: background runs are
 * polled, never pushed). Nothing runs while nothing is live; the latest `tick`
 * is always the one called.
 */
export const useLivePoll = (live: boolean, tick: () => Promise<void> | void, ms: number = RUN_POLL_MS): void => {
  const latest = useRef(tick)
  latest.current = tick
  useEffect(() => {
    if (!live) return undefined
    const timer = window.setInterval(() => {
      void latest.current()
    }, ms)
    return () => {
      window.clearInterval(timer)
    }
  }, [live, ms])
}
