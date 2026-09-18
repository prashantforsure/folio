'use client'

import type { ScriptFormat } from '@folio/script'
import { Icon } from '@folio/ui'
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { ExcerptLine } from '../../../../../../lib/scenes/excerpt'
import type { SceneCard } from '../../../../../../lib/scenes/server'
import { READING_FORMATS, readingLayout } from '../../../../../../lib/scenes/sheet'
import type { ReadingLayout } from '../../../../../../lib/scenes/sheet'
import { count } from '../../../../../../lib/workspace/format'
import { sceneNo } from './scene-parts'

/**
 * The reading modal (2026-09-17): a scene's script tile, clicked, opens the
 * whole scene on a grey, grained sheet in Courier over a blurred, dimmed
 * canvas - the reference screenshot's shape, the client's ask. `Hollywood |
 * Asian` at the top, a round ✕ beside the top-right corner, the scene
 * below; Escape and the scrim close it.
 *
 * ## Portalled to `body`
 *
 * The main-surface card carries a `backdrop-filter`, which makes it the
 * containing block for every `position: fixed` descendant, and a card on
 * the canvas sits under a `transform`, which does the same. A modal inside
 * either would cover that box, not the window. So it renders through a
 * portal into `document.body`, where `fixed` means the viewport and the
 * scrim's own blur reaches the sidebar and the rail too.
 *
 * ## The toggle is the engine's question
 *
 * The sheet opens on the project's format and the toggle changes the
 * modal's, not the project's (that is the Script route's Format menu).
 * `readingLayout` asks `resolveSheet` for the insets; Hollywood answers
 * with US Letter's, Asian with the refusal that is open decision 8, and
 * the refusal is drawn where the sheet would be, in the engine's words,
 * with its evidence - not a guessed A4 and not a disabled tab.
 *
 * ## Read, not measured
 *
 * The lines wrap where the browser wraps them at the sheet's proportional
 * insets (`lib/scenes/sheet.ts`). No count is read off this render; the
 * card's `pg` and eighths stay the measurement record's.
 *
 * ## Two pieces, two readers
 *
 * `PaperModal` is the scrim, the portal, the close and Escape;
 * `ReadingPaper` is the sheet with its format toggle and meta line.
 * `ScriptModal` puts one scene on them; the Timeline's `Read in story
 * order` (`_timeline/read-modal.tsx`) walks every placed scene through
 * the same two, a scene at a time, with `Previous` and `Next` in the
 * slot under the toggle.
 */
export const PaperModal = ({ attr, onClose, children }: { readonly attr: Readonly<Record<string, string>>; readonly onClose: () => void; readonly children: ReactNode }) => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!mounted) return null
  return createPortal(
    <div
      className="folio-modal-scrim"
      {...attr}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-[720px]">
        <button type="button" className="folio-paper-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" size={14} strokeWidth={1.5} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** The grained sheet: the format toggle, the meta line, an optional row of controls, then the scene at the sheet's insets or the engine's refusal. */
export const ReadingPaper = ({
  lines,
  heading,
  meta,
  format,
  onFormat,
  controls,
}: {
  readonly lines: readonly ExcerptLine[]
  readonly heading: string
  /** `Scene 4 · 12 lines · US Letter`. */
  readonly meta: string
  readonly format: ScriptFormat
  readonly onFormat: (format: ScriptFormat) => void
  readonly controls?: ReactNode
}) => {
  const headingId = useId()
  const layout = readingLayout(format)
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={headingId} className="folio-paper flex max-h-[86vh] flex-col overflow-hidden">
      <div className="flex flex-none flex-col items-center gap-[6px] px-[28px] pb-[10px] pt-[18px]">
        <div className="folio-paper-toggle" role="group" aria-label="Page format">
          {READING_FORMATS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={format === entry.id}
              data-reading-format={entry.id}
              title={entry.page}
              onClick={() => {
                onFormat(entry.id)
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <span className="font-mono text-10-5 text-paper-ink2">{meta}</span>
        {controls}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[28px] pb-[36px] pt-[14px]">
        {layout.ok ? <Sheet lines={lines} layout={layout} headingId={headingId} /> : <Refusal layout={layout} headingId={headingId} heading={heading} onHollywood={() => onFormat('hollywood')} />}
      </div>
    </div>
  )
}

export const ScriptModal = ({ card, format: initialFormat, onClose }: { readonly card: SceneCard; readonly format: ScriptFormat; readonly onClose: () => void }) => {
  const [format, setFormat] = useState<ScriptFormat>(initialFormat)
  const lines = card.excerpt.lines
  return (
    <PaperModal attr={{ 'data-script-modal': card.derived.sceneNodeId, 'data-script-format': format }} onClose={onClose}>
      <ReadingPaper
        lines={lines}
        heading={card.derived.heading}
        meta={`Scene ${sceneNo(card.derived.number)} · ${count(lines.length)} line${lines.length === 1 ? '' : 's'} · ${READING_FORMATS.find((entry) => entry.id === format)?.page ?? ''}`}
        format={format}
        onFormat={setFormat}
      />
    </PaperModal>
  )
}

/** The scene on the sheet: every node, Courier, at the sheet's proportional insets. */
const Sheet = ({ lines, layout, headingId }: { readonly lines: readonly ExcerptLine[]; readonly layout: Extract<ReadingLayout, { readonly ok: true }>; readonly headingId: string }) => (
  <div data-script-sheet className="flex flex-col">
    {lines.map((line, index) => {
      const inset = layout.inset(line.type, index === 0)
      const Tag = line.type === 'scene' ? 'h2' : 'p'
      return (
        <Tag
          key={line.id}
          id={line.type === 'scene' && index === 0 ? headingId : undefined}
          data-type={line.type}
          className="folio-script-line"
          style={{
            paddingLeft: inset.left,
            paddingRight: inset.right,
            marginTop: `${String(inset.blankLinesBefore * 1.6)}em`,
          }}
        >
          {line.text === '' ? ' ' : line.text}
        </Tag>
      )
    })}
  </div>
)

/** Open decision 8 on the sheet: the engine's refusal, its evidence, and the way back. */
const Refusal = ({
  layout,
  headingId,
  heading,
  onHollywood,
}: {
  readonly layout: Extract<ReadingLayout, { readonly ok: false }>
  readonly headingId: string
  readonly heading: string
  readonly onHollywood: () => void
}) => (
  <div data-script-refusal className="flex flex-col gap-[14px]">
    <h2 id={headingId} data-type="scene" className="folio-script-line">
      {heading}
    </h2>
    <div className="folio-paper-refusal">
      <span className="folio-eyebrow text-paper-ink2">
        A4 · open decision {layout.refusal.openDecision}
      </span>
      <span>{layout.refusal.detail}</span>
      <ul className="m-0 flex list-none flex-col gap-[6px] p-0 font-mono text-11-5">
        {layout.refusal.evidence.map((row) => (
          <li key={row.source} className="flex flex-col gap-[1px]">
            <span className="text-paper-ink">
              {row.source} · {row.widthPx}px
            </span>
            <span>{row.note}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-read-hollywood
        className="folio-paper-button self-start"
        onClick={onHollywood}
      >
        Read it as Hollywood for now
      </button>
    </div>
  </div>
)
