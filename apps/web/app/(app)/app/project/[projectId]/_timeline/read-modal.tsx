'use client'

import type { ProjectId } from '@folio/contracts'
import type { NodeId, ScriptFormat } from '@folio/script'
import { useEffect, useState } from 'react'

import type { ExcerptLine } from '../../../../../../lib/scenes/excerpt'
import { READING_FORMATS } from '../../../../../../lib/scenes/sheet'
import { readSceneLines } from '../../../../../../lib/timeline/actions'
import { PaperModal, ReadingPaper } from '../_scenes/script-modal'

/**
 * `Read in story order` - the toolbar's `⋯` (the rebuild, phase 4): every
 * placed scene on the Scenes route's grained sheet (`_scenes/script-modal.tsx`,
 * its two pieces), one at a time, walked by story time rather than page
 * order - a flashback where it happened, not where it is written. The
 * meta line says where the sheet is (`3 of 17 · E1 Sc 4 · Day 2 · 06:40`);
 * `Previous` and `Next` turn the page, as do `←` and `→`.
 *
 * A scene's lines are read when the reader turns to it
 * (`readSceneLines`), not shipped with the route: a series is the whole
 * script, and the reader wants one scene at a time. The sheet opens on
 * the Hollywood format; the toggle is the modal's, as on Scenes.
 */
export const ReadModal = ({
  projectId,
  order,
  current,
  labelOf,
  headingOf,
  onTurn,
  onClose,
}: {
  readonly projectId: ProjectId
  /** The placed scenes in story order. */
  readonly order: readonly NodeId[]
  readonly current: NodeId
  /** `E1 Sc 4 · Day 2 · 06:40`. */
  readonly labelOf: (id: NodeId) => string
  readonly headingOf: (id: NodeId) => string
  readonly onTurn: (id: NodeId) => void
  readonly onClose: () => void
}) => {
  const [format, setFormat] = useState<ScriptFormat>('hollywood')
  const [lines, setLines] = useState<readonly ExcerptLine[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const at = order.indexOf(current)
  const previous = at > 0 ? (order[at - 1] ?? null) : null
  const next = at >= 0 && at < order.length - 1 ? (order[at + 1] ?? null) : null

  useEffect(() => {
    let cancelled = false
    setLines(null)
    setNotice(null)
    void readSceneLines(projectId, current).then((result) => {
      if (cancelled) return
      if (result.status === 'ok') setLines(result.lines)
      else setNotice(result.message)
    })
    return () => {
      cancelled = true
    }
  }, [current, projectId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft' && previous !== null) onTurn(previous)
      if (event.key === 'ArrowRight' && next !== null) onTurn(next)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [next, onTurn, previous])

  const page = READING_FORMATS.find((entry) => entry.id === format)?.page ?? ''
  const shown = lines ?? [{ id: current, type: 'scene' as const, text: headingOf(current) }, { id: `${current}:loading` as NodeId, type: 'action' as const, text: notice ?? 'Reading…' }]

  return (
    <PaperModal attr={{ 'data-read-modal': current, 'data-script-format': format }} onClose={onClose}>
      <ReadingPaper
        lines={shown}
        heading={headingOf(current)}
        meta={`${String(at + 1)} of ${String(order.length)} · ${labelOf(current)} · ${page}`}
        format={format}
        onFormat={setFormat}
        controls={
          <div className="flex items-center gap-[8px]">
            <button type="button" className="folio-paper-button" data-read-previous disabled={previous === null} onClick={() => previous !== null && onTurn(previous)}>
              ← Previous
            </button>
            <button type="button" className="folio-paper-button" data-read-next disabled={next === null} onClick={() => next !== null && onTurn(next)}>
              Next →
            </button>
          </div>
        }
      />
    </PaperModal>
  )
}
