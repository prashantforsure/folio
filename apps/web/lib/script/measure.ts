import type { LockedPage, MentionLabel, RevisionColour, ScreenplayNode, ScriptFormat } from '@folio/script'
import { paginate } from '@folio/script'

import { digestOf } from './digest'
import type { MeasureOutcome } from './result'

/**
 * The two pagination passes the workspace runs between keystrokes, as one
 * pure function over one request.
 *
 * Written to run in a Web Worker - `paginate` has no DOM, no I/O and no
 * clock, which is exactly what would let it ("must run identically in the
 * browser, in server code, in the worker and in tests", AGENTS.md) - and
 * kept off one: Turbopack in Next 16.3 emits
 * `new Worker(new URL('./x.ts', import.meta.url))` as a raw static asset
 * rather than a bundled worker, so the worker would fail to load on every
 * session (`docs/build-decisions.md`, "Script route, fifth pass").
 * `measure-client.ts` runs this in idle time on the main thread instead.
 * When the bundler can build a worker, the worker entry is
 * `self.onmessage = (e) => self.postMessage(measureNodes(e.data))` and
 * nothing here changes.
 *
 * The protocol is one request, one reply, keyed by `serial` so a reply for
 * a document the writer has since changed is dropped by the caller.
 */

export type PaginateRequest = {
  readonly serial: number
  readonly nodes: readonly ScreenplayNode[]
  readonly format: ScriptFormat
  readonly pageMode: 'paged' | 'continuous'
  readonly liveRepaginate: boolean
  readonly mentionLabels: readonly MentionLabel[]
  readonly lockedPages: readonly LockedPage[]
  readonly revision: RevisionColour
}

export type PaginateReply = {
  readonly serial: number
  /** `null` when the engine refused; the server's answer then carries the refusal. */
  readonly measurement: MeasureOutcome | null
  readonly digest: string | null
}

/** The same two passes the save path runs: the project's mode, and `paged` for the status bar and the page map. */
export const measureNodes = (request: PaginateRequest): PaginateReply => {
  const base = {
    format: request.format,
    liveRepaginate: request.liveRepaginate,
    mentionLabels: request.mentionLabels,
    lockedPages: request.lockedPages,
    revision: request.revision,
  }
  const measured = paginate(request.nodes, { ...base, pageMode: request.pageMode })
  if (!measured.ok) return { serial: request.serial, measurement: null, digest: null }
  const pagedRecord = request.pageMode === 'paged' ? measured : paginate(request.nodes, { ...base, pageMode: 'paged' })
  if (!pagedRecord.ok) return { serial: request.serial, measurement: null, digest: null }
  return {
    serial: request.serial,
    measurement: { ok: true, record: measured.value, paged: pagedRecord.value },
    digest: digestOf([measured.value, pagedRecord.value]),
  }
}
