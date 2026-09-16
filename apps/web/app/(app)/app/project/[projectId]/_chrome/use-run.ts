'use client'

import { useCallback, useRef, useState } from 'react'

import type { SaveIndicator } from './status-bar'

/** Run a write, and report. `null` from the job means it succeeded; a string is the failure the caller shows. */
export type Run = (job: () => Promise<string | null>) => void

/**
 * The status bar's save indicator over a route's writes - the pattern the
 * Characters workspace carries inline (`_characters/characters-workspace.tsx`)
 * and the Research pass needed a second time (2026-09-16).
 *
 * Amber while any write is in flight, orange after one fails, green once
 * the last one lands. Overlapping writes are counted, so the dot goes green
 * when the *last* of them finishes, not the first. A thrown error is a
 * failure too, with its message; nothing reaches the console unreported.
 */
export const useRun = (initial: SaveIndicator = 'idle'): { readonly save: SaveIndicator; readonly run: Run } => {
  const [save, setSave] = useState<SaveIndicator>(initial)
  const pending = useRef(0)
  const run: Run = useCallback((job) => {
    pending.current += 1
    setSave('saving')
    void (async () => {
      let failure: string | null
      try {
        failure = await job()
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : 'The save did not reach the server.'
      } finally {
        pending.current -= 1
      }
      if (failure !== null) setSave('error')
      else if (pending.current === 0) setSave('saved')
    })()
  }, [])
  return { save, run }
}
