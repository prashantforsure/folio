'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * No realtime (AGENTS.md, Constraints): while something the page shows is
 * `queued` or `running` on the worker - a Production generation, a
 * Storyboard frame - the page refreshes every three seconds, so progress and
 * end states reach the screen. Nothing runs while nothing is live. Shared
 * chrome since roadmap task 4.3 moved Storyboard's frames onto the worker.
 */
export const Polling = ({ live }: { readonly live: boolean }) => {
  const router = useRouter()
  useEffect(() => {
    if (!live) return undefined
    const timer = window.setInterval(() => {
      router.refresh()
    }, 3000)
    return () => {
      window.clearInterval(timer)
    }
  }, [live, router])
  return null
}
