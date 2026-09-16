'use client'

import { useEffect, useState } from 'react'

/**
 * The window's width, after hydration.
 *
 * The server does not know the viewport, so the first client render must
 * agree with it and draw the defaults; only then is the real width read. Every
 * breakpoint decision in the shell (`docs/ui design/README.md`, "Breakpoints")
 * goes through this one hook so the four workspaces that used to carry their
 * own resize listener agree on the same number at the same moment.
 *
 * `mounted` is the hydration flag the same components need for the
 * sessionStorage-backed flags, which also differ between server and client.
 */
export type Viewport = {
  readonly mounted: boolean
  readonly width: number
}

const SERVER_WIDTH = 1440

export const useViewport = (): Viewport => {
  const [state, setState] = useState<Viewport>({ mounted: false, width: SERVER_WIDTH })
  useEffect(() => {
    const read = (): void => {
      setState({ mounted: true, width: window.innerWidth })
    }
    read()
    window.addEventListener('resize', read)
    return () => {
      window.removeEventListener('resize', read)
    }
  }, [])
  return state
}
