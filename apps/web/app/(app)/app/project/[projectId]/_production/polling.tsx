'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * No realtime (AGENTS.md, Constraints): while a generation is `queued` or
 * `running` in the loaded episode the page refreshes every three seconds,
 * so the runner's progress and end states reach the screen. Nothing runs
 * while nothing is live.
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
