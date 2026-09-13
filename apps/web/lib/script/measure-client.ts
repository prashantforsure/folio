import type { PaginateReply, PaginateRequest } from './measure'
import { measureNodes } from './measure'

/**
 * The workspace's handle on live measurement: `measureNodes`, scheduled in
 * idle time so a pass over three thousand nodes lands between keystrokes
 * rather than under one.
 *
 * `requestIdleCallback` with a deadline, so a writer who never pauses still
 * gets a measurement within the second; `setTimeout` where the platform
 * has no idle callback. One request per serial; a reply's serial says
 * which document it measured, and the caller drops one for a document that
 * has moved on. A newer request supersedes a queued older one: only the
 * latest is ever run.
 *
 * Shaped as a `Measurer` so the day the bundler can build a worker
 * (`measure.ts`, header), the worker-backed implementation is a drop-in.
 */

export type Measurer = {
  readonly measure: (request: PaginateRequest) => Promise<PaginateReply>
  readonly dispose: () => void
}

/** Never later than this after the request, idle or not. */
const IDLE_TIMEOUT_MS = 1000

type Scheduled = { readonly cancel: () => void }

const whenIdle = (run: () => void): Scheduled => {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS })
    return { cancel: () => cancelIdleCallback(handle) }
  }
  const handle = setTimeout(run, 0)
  return { cancel: () => clearTimeout(handle) }
}

export const createMeasurer = (): Measurer => {
  let queued: { readonly scheduled: Scheduled; readonly request: PaginateRequest; readonly resolve: (reply: PaginateReply) => void } | null = null

  const supersede = (): void => {
    if (queued === null) return
    queued.scheduled.cancel()
    // The superseded request is answered as a refusal the caller ignores by serial.
    queued.resolve({ serial: queued.request.serial, measurement: null, digest: null })
    queued = null
  }

  return {
    measure: (request) =>
      new Promise<PaginateReply>((resolve) => {
        supersede()
        const scheduled = whenIdle(() => {
          queued = null
          resolve(measureNodes(request))
        })
        queued = { scheduled, request, resolve }
      }),
    dispose: () => {
      supersede()
    },
  }
}
