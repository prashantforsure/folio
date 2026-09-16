'use client'

import type { ProjectId, ResearchClipId, ResearchClipRow, ResearchSourceRow } from '@folio/contracts'
import { RESEARCH_CLIP_MAX } from '@folio/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clipLine } from '../../../../../../lib/research/actions'
import { setResearchDrawer } from '../../../../../../lib/research/compose'
import type { FilingTargets } from '../../../../../../lib/research/server'
import { bylineOf, clipsLabel, highlightParagraphs, sourceKindLine } from '../../../../../../lib/research/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { Run } from '../_chrome/use-run'
import { ClipMenu } from './clip-menu'

/**
 * A source, read - `Route - Research v2.dc.html`'s `Source` view: a 720px
 * column; `← Library`, the `kind · collection` line, `❝ N clips` in amber
 * and `Edit`; the title at 26px/400; the byline at 12.5px `--ink3`; the
 * paragraphs at 15px/1.72 in `--read` with each clip's line washed in
 * `--mark`; and the footer card - "Highlighted lines become clips you can
 * file." with `All clips →`.
 *
 * ## Highlighting a line makes a clip
 *
 * The mockup's caption is the behaviour: select text inside the body and a
 * `❝ Clip this line` pill floats under the selection; pressing it cuts the
 * clip (`clipLine`) from the selected text and the page re-reads, so the
 * line is washed the next paint. A selection that reaches outside the body
 * or is empty shows nothing. A highlighted line is a button: it opens the
 * clip's menu (`clip-menu.tsx`) - where it is filed, `Send to…`, remove.
 *
 * Which lines are washed is `highlightParagraphs` (`lib/research/view.ts`)
 * over the stored clips; a clip whose text is no longer in the body draws
 * no wash and still counts.
 */
export const SourceView = ({
  projectId,
  source,
  clips,
  targets,
  baseHref,
  run,
}: {
  readonly projectId: ProjectId
  readonly source: ResearchSourceRow
  readonly clips: readonly ResearchClipRow[]
  readonly targets: FilingTargets
  readonly baseHref: ProjectRoutePath
  readonly run: Run
}) => {
  const router = useRouter()
  const scroller = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<{ readonly text: string; readonly x: number; readonly y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<ResearchClipId | null>(null)
  const [mounted, setMounted] = useState(false)

  const paragraphs = useMemo(() => highlightParagraphs(source.body, clips), [clips, source.body])
  const byline = bylineOf(source)
  const clipsById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips])

  // Read the selection after it settles; place the pill under its last line.
  const readSelection = useCallback(() => {
    const host = body.current
    const frame = scroller.current
    if (host === null || frame === null) return
    const selection = document.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
      setPending(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) {
      setPending(null)
      return
    }
    const text = selection.toString().replace(/\s+/g, ' ').trim()
    if (text === '' || text.length > RESEARCH_CLIP_MAX) {
      setPending(null)
      return
    }
    const rects = range.getClientRects()
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect()
    const frameBox = frame.getBoundingClientRect()
    setPending({
      text,
      x: last.left + last.width / 2 - frameBox.left,
      y: last.bottom - frameBox.top + frame.scrollTop + 8,
    })
  }, [])

  useEffect(() => {
    setMounted(true)
    const onUp = (): void => {
      window.setTimeout(readSelection, 0)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPending(null)
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keyup', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keyup', onUp)
      document.removeEventListener('keydown', onKey)
    }
  }, [readSelection])

  const cut = (): void => {
    if (pending === null) return
    const text = pending.text
    setBusy(true)
    run(async () => {
      const result = await clipLine(projectId, source.id, { text })
      setBusy(false)
      if (result.status !== 'clipped') return result.message
      setPending(null)
      document.getSelection()?.removeAllRanges()
      router.refresh()
      return null
    })
  }

  return (
    <div ref={scroller} data-source-view={source.id} data-mounted={mounted ? 'true' : 'false'} className="relative min-h-0 flex-1 overflow-y-auto px-[20px] pb-[40px]">
      <div className="mx-auto flex max-w-[720px] flex-col gap-[22px]">
        <div className="flex flex-col gap-[11px]">
          <div className="flex flex-wrap items-center gap-[10px]">
            <Link href={baseHref} data-back-to-library className="folio-line-button h-[28px] rounded-[8px] px-[11px] text-12 no-underline hover:no-underline">
              ← Library
            </Link>
            <span className="text-11-5 text-ink3" data-source-kind-line>
              {sourceKindLine(source)}
            </span>
            <span className="flex-1" />
            <span className="flex items-center gap-[6px] text-11-5 text-warn" data-source-clip-count={clips.length}>
              <span className="folio-mark">❝</span> {clipsLabel(clips.length)}
            </span>
            <button
              type="button"
              data-edit-source
              onClick={() => {
                setResearchDrawer({ kind: 'edit', id: source.id })
              }}
              className="folio-line-button h-[28px] rounded-[8px] px-[11px] text-12"
            >
              Edit
            </button>
          </div>
          <h2 className="m-0 text-26 font-normal leading-[1.2] tracking-page" style={{ textWrap: 'pretty' }} data-source-title>
            {source.title}
          </h2>
          {byline === null ? null : (
            <p className="m-0 text-12-5 leading-[1.6] text-ink3" style={{ textWrap: 'pretty' }} data-source-byline>
              {byline}
            </p>
          )}
        </div>

        {paragraphs.length === 0 ? (
          <p className="m-0 text-13 leading-[1.6] text-ink3" data-source-no-text>
            No text for this source yet. Add a transcript or the copy in Edit and lines can be clipped from it.
          </p>
        ) : (
          <div ref={body} className="flex flex-col gap-[16px]" data-source-body>
            {paragraphs.map((parts, index) => (
              <p key={index} className="m-0 text-15 leading-[1.72] text-read" style={{ textWrap: 'pretty' }}>
                {parts.map((part, i) => {
                  if (part.clipId === null) return <span key={i}>{part.text}</span>
                  const clip = clipsById.get(part.clipId)
                  return (
                    <span key={i} className="relative">
                      <button
                        type="button"
                        data-clip-mark={part.clipId}
                        aria-expanded={open === part.clipId}
                        title={clip !== undefined && clip.filings.length > 0 ? 'Filed - see where' : 'Not filed yet - send it somewhere'}
                        onClick={() => {
                          setOpen((current) => (current === part.clipId ? null : part.clipId))
                        }}
                        className="folio-clip-mark"
                      >
                        {part.text}
                      </button>
                      {open === part.clipId && clip !== undefined ? (
                        <ClipMenu projectId={projectId} clip={clip} targets={targets} run={run} onClose={() => setOpen(null)} />
                      ) : null}
                    </span>
                  )
                })}
              </p>
            ))}
          </div>
        )}

        <div className="flex items-center gap-[10px] rounded-card border border-line2 bg-s1 px-[14px] py-[12px]">
          <span className="min-w-0 flex-1 text-12-5 text-ink2">Highlighted lines become clips you can file.</span>
          <Link
            href={{ pathname: baseHref, query: { view: 'clips' } }}
            data-all-clips
            className="folio-line-button h-[28px] flex-none whitespace-nowrap rounded-[8px] px-[12px] text-12 no-underline hover:no-underline"
            data-line="strong"
          >
            All clips →
          </Link>
        </div>
      </div>

      {pending === null ? null : (
        <button
          type="button"
          data-clip-this
          disabled={busy}
          onMouseDown={(event) => {
            // Keep the selection: a mousedown would collapse it before the click lands.
            event.preventDefault()
          }}
          onClick={cut}
          className="folio-clip-this"
          style={{ left: pending.x, top: pending.y }}
        >
          <span className="folio-mark">❝</span> {busy ? 'Clipping…' : 'Clip this line'}
        </button>
      )}
    </div>
  )
}
