'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { Glyph } from '@folio/ui'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { saveSynopsis } from '../../../../../../lib/scenes/actions'
import { CARD_EXCERPT_LINES } from '../../../../../../lib/scenes/excerpt'
import type { ExcerptLine, UnacceptedHeading } from '../../../../../../lib/scenes/excerpt'
import type { SynopsisResult } from '../../../../../../lib/scenes/result'
import type { SceneCard } from '../../../../../../lib/scenes/server'
import { ABSENT, count, eighths as formatEighths } from '../../../../../../lib/workspace/format'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { ScenesView } from './scenes-header'
import { UnacceptedList } from './unaccepted'

/**
 * The board: three views over the same cards, a detail card, one editor.
 *
 * `Route - Scenes.dc.html` is the pattern; everything drawn here is that
 * bundle's geometry with the tokens in place of its hexes. Where the bundle
 * and the rules disagree, the rules win and the disagreement is in the phase
 * report: no `New scene`, no `New card`, no drag, no "Colour by", no act
 * columns (acts are not a table), and the AI summarise button on an empty
 * synopsis is a plain "write one" instead - scene-level AI belongs elsewhere.
 *
 * ## Where every value on a card comes from
 *
 * Nothing on a card is computed here. Each is read from `SceneCard`, whose
 * loader names the table:
 *
 *   number, heading, I/E, time     `derived`  - `scene_derivations`
 *   `N lines` (dialogue nodes)     `derived.lines`
 *   `N chars` (cast size)          `derived.castSize`
 *   cast chips                     `cast`     - ids from `scene_derivations.cast`,
 *                                               names from `characters.name`
 *   `pg N`, eighths                `measured` - `measurement_scenes`; `—` when
 *                                               there is no measurement record
 *   the excerpt                    `excerpt`  - the node list, cut at the
 *                                               headings derivation accepted
 *   synopsis                       `derived.synopsis` - `scenes`, authored
 *
 * `formatEighths` and `count` are the chrome's formatters (`format.ts`); they
 * print a number, they do not produce one.
 *
 * ## Selection is component state
 *
 * The client ruled it (2026-09-11): there is no `/scenes/:sceneId` and no
 * scene id in the URL. Clicking a scene opens a detail card in place, and
 * what is selected lives in React state - it does not survive a reload, and
 * it is not meant to. `?view=` is the only URL state and it arrives parsed.
 *
 * ## The one write
 *
 * The synopsis. It goes through `saveSynopsis` to `scenes.synopsis` and
 * nowhere near the node list. After a save the server revalidates and the
 * new value arrives in props; `saved` below is only the transient copy shown
 * until it does.
 *
 * Zoom is React state, not the session store's `zoom` - that is the sheet's
 * zoom on the Script route, and a card size is not a sheet size. Assumption,
 * flagged.
 */

type Props = {
  readonly view: ScenesView
  readonly projectId: ProjectId
  readonly episode: EpisodeSlug
  readonly routeTag: string
  readonly productionHref: EpisodeRoutePath
  readonly scenes: readonly SceneCard[]
  /** `measurements.total_pages`, or `null` when the script has never been measured. */
  readonly totalPages: number | null
  readonly measured: boolean
  /** The measurement's node digest no longer matches the node list. */
  readonly stale: boolean
  readonly unaccepted: readonly UnacceptedHeading[]
}

const VIEW_LABEL: Record<ScenesView, string> = {
  cards: 'Scene cards',
  index: 'Index cards',
  list: 'Scene list',
}

/** `01`, `12`, `220`. The bundle zero-pads to two. */
const sceneNo = (number: number): string => String(number).padStart(2, '0')

const pageLabel = (card: SceneCard): string =>
  card.measured === null ? ABSENT : String(card.measured.startPage)

const pageRange = (card: SceneCard): string => {
  if (card.measured === null) return ABSENT
  const { startPage, endPage } = card.measured
  return startPage === endPage ? String(startPage) : `${String(startPage)}–${String(endPage)}`
}

const eighthsLabel = (card: SceneCard): string =>
  formatEighths(card.measured === null ? null : card.measured.eighths)

const timeLabel = (card: SceneCard): string => card.derived.reading.timeOfDay ?? ABSENT

const hasSynopsis = (value: string | null): value is string => value !== null && value !== ''

// ---------------------------------------------------------------------------
// The excerpt, drawn as a miniature page
// ---------------------------------------------------------------------------

/**
 * The bundle's `L()` insets: character 38%, parenthetical 30% each side,
 * dialogue 22% each side, action full width. Transition and subtitle are not
 * in the bundle's preview; a transition sits right and a subtitle centred,
 * as they do on the sheet.
 */
const lineStyle = (type: ExcerptLine['type']): CSSProperties => {
  switch (type) {
    case 'scene':
      return { textTransform: 'uppercase' }
    case 'character':
      return { paddingLeft: '38%', textTransform: 'uppercase' }
    case 'paren':
      return { paddingLeft: '30%', paddingRight: '30%', color: 'var(--ink2)' }
    case 'dialogue':
      return { paddingLeft: '22%', paddingRight: '22%' }
    case 'transition':
      return { textAlign: 'right', textTransform: 'uppercase' }
    case 'subtitle':
      return { textAlign: 'center' }
    case 'action':
      return {}
  }
}

const ExcerptLines = ({
  lines,
  limit,
  className,
}: {
  readonly lines: readonly ExcerptLine[]
  readonly limit?: number
  readonly className: string
}) => {
  const shown = limit === undefined ? lines : lines.slice(0, limit)
  return (
    <div className={className}>
      {shown.map((line, index) => (
        <div
          key={line.id}
          data-line-type={line.type}
          style={{
            ...lineStyle(line.type),
            marginTop: index === 1 || line.type === 'character' ? '0.8em' : 0,
            whiteSpace: limit === undefined ? 'pre-wrap' : 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {line.text === '' ? ' ' : line.text}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

const Stat = ({
  glyph,
  title,
  children,
}: {
  readonly glyph: 'characters' | 'notes' | 'script'
  readonly title: string
  readonly children: ReactNode
}) => (
  <span
    title={title}
    className="flex items-center gap-[5px] whitespace-nowrap rounded-chrome border border-line2 px-[7px] py-[2px] text-10 text-ink2"
  >
    <Glyph name={glyph} className="text-9-5 text-ink3" />
    {children}
  </span>
)

const CastChip = ({ name, small }: { readonly name: string; readonly small?: boolean }) => (
  <span
    className={`whitespace-nowrap rounded-chrome border border-accent-line bg-accent-bg px-[6px] py-[1px] text-accent ${
      small === true ? 'text-9-5' : 'text-10'
    }`}
  >
    @{name}
  </span>
)

// ---------------------------------------------------------------------------
// The synopsis editor
// ---------------------------------------------------------------------------

const SynopsisEditor = ({
  projectId,
  episode,
  card,
  value,
  autoFocus,
  onSaved,
}: {
  readonly projectId: ProjectId
  readonly episode: EpisodeSlug
  readonly card: SceneCard
  readonly value: string | null
  readonly autoFocus: boolean
  readonly onSaved: (sceneNodeId: NodeId, synopsis: string | null) => void
}) => {
  const [draft, setDraft] = useState(value ?? '')
  const [result, setResult] = useState<SynopsisResult | null>(null)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const dirty = draft.trim() !== (value ?? '').trim()

  const save = () => {
    start(async () => {
      const outcome = await saveSynopsis({
        projectId,
        episode,
        sceneNodeId: card.derived.sceneNodeId,
        synopsis: draft,
      })
      setResult(outcome)
      if (outcome.status === 'saved') onSaved(card.derived.sceneNodeId, outcome.synopsis)
    })
  }

  return (
    <div className="flex flex-col gap-[6px]" data-synopsis-editor>
      <div className="flex items-baseline gap-[8px]">
        <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Synopsis</span>
        <span className="text-9-5 text-ink3">authored · kept through every re-derive</span>
      </div>
      <textarea
        ref={ref}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setResult(null)
        }}
        rows={3}
        placeholder="One line on what happens in this scene."
        className="w-full resize-y rounded-chrome border border-line bg-sheet p-[8px] font-serif text-14 leading-[22px] text-sheet-ink outline-none focus:border-accent-line"
      />
      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-chrome border border-none bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink disabled:cursor-default disabled:opacity-50"
        >
          {pending && result === null ? 'Saving…' : 'Save synopsis'}
        </button>
        {result === null ? null : (
          <span
            className={`text-10-5 ${result.status === 'saved' ? 'text-add' : 'text-del'}`}
            role="status"
          >
            {result.status === 'saved' ? 'Saved to the scene record' : result.message}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The detail card
// ---------------------------------------------------------------------------

const Field = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-[2px]">
    <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">{label}</span>
    <span className="tabular min-w-0 truncate text-11-5 text-ink">{children}</span>
  </div>
)

const DetailCard = ({
  card,
  synopsis,
  focusEditor,
  projectId,
  episode,
  productionHref,
  onClose,
  onSaved,
}: {
  readonly card: SceneCard
  readonly synopsis: string | null
  readonly focusEditor: boolean
  readonly projectId: ProjectId
  readonly episode: EpisodeSlug
  readonly productionHref: EpisodeRoutePath
  readonly onClose: () => void
  readonly onSaved: (sceneNodeId: NodeId, synopsis: string | null) => void
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const nameOf = new Map(card.cast.map((member) => [member.id, member.name]))
  const speaking = card.derived.speaking.map((id) => nameOf.get(id) ?? '(record missing)')
  const mentioned = card.derived.mentioned.map((id) => nameOf.get(id) ?? '(record missing)')

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-scrim p-[24px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      data-scene-detail
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-detail-heading"
        className="flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-chrome border border-line bg-panel"
      >
        <div className="flex flex-none items-baseline gap-[10px] border-b border-line px-[16px] py-[12px]">
          <span className="font-serif text-20 font-medium leading-none text-ink3">
            {sceneNo(card.derived.number)}
          </span>
          <h2
            id="scene-detail-heading"
            className="m-0 min-w-0 flex-1 truncate font-mono text-14 font-bold uppercase tracking-[.01em]"
          >
            {card.derived.heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-[22px] w-[22px] flex-none place-items-center rounded-chrome border border-line2 bg-transparent text-12 text-ink2 hover:bg-hover"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-auto p-[16px]">
          <div className="grid grid-cols-4 gap-[12px]">
            <Field label="Int / Ext">{card.derived.reading.ie}</Field>
            <Field label="Set">{card.derived.reading.set}</Field>
            <Field label="Time">{timeLabel(card)}</Field>
            <Field label="Light">{card.derived.reading.light}</Field>
            <Field label="Page">{pageRange(card)}</Field>
            <Field label="Eighths">{eighthsLabel(card)}</Field>
            <Field label="Lines on the page">
              {card.measured === null ? ABSENT : count(card.measured.lines)}
            </Field>
            <Field label="Dialogue nodes">{count(card.derived.lines)}</Field>
          </div>
          {card.measured === null ? (
            <p className="m-0 text-10-5 text-note">
              Page, eighths and lines on the page come from the measurement record, and this
              script has no measurement yet. Nothing here estimates them.
            </p>
          ) : null}

          <div className="flex flex-col gap-[6px]">
            <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">
              Cast · {count(card.derived.castSize)}
            </span>
            <div className="flex flex-wrap items-center gap-[6px]">
              {speaking.map((name, index) => (
                <CastChip key={`s-${String(index)}`} name={name} />
              ))}
              {mentioned.length === 0 ? null : (
                <span className="text-9-5 text-ink3">mentioned</span>
              )}
              {mentioned.map((name, index) => (
                <CastChip key={`m-${String(index)}`} name={name} small />
              ))}
              {card.derived.castSize === 0 ? (
                <span className="text-10-5 text-ink3">Nobody speaks or is mentioned.</span>
              ) : null}
            </div>
            {card.derived.unresolvedCues.length === 0 ? null : (
              <p className="m-0 text-10-5 text-note">
                {count(card.derived.unresolvedCues.length)} cue
                {card.derived.unresolvedCues.length === 1 ? '' : 's'} not yet matched to a record:{' '}
                <span className="font-mono">{card.derived.unresolvedCues.join(', ')}</span>. Resolve
                them on Characters.
              </p>
            )}
          </div>

          <SynopsisEditor
            projectId={projectId}
            episode={episode}
            card={card}
            value={synopsis}
            autoFocus={focusEditor}
            onSaved={onSaved}
          />

          <div className="flex flex-col gap-[6px]">
            <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">
              The scene · {count(card.excerpt.lines.length)} node
              {card.excerpt.lines.length === 1 ? '' : 's'} from the script
            </span>
            <ExcerptLines
              lines={card.excerpt.lines}
              className="rounded-sheet border border-sheet-edge bg-sheet px-[24px] py-[18px] font-mono text-11 leading-[1.6] text-sheet-ink"
            />
          </div>
        </div>

        <div className="flex flex-none gap-[6px] border-t border-line2 px-[16px] py-[10px]">
          <Link
            href={productionHref}
            className="flex flex-1 items-center justify-center gap-[6px] whitespace-nowrap rounded-chrome border border-accent-line px-[8px] py-[6px] text-11-5 font-medium text-accent no-underline hover:bg-accent-bg hover:no-underline"
          >
            <Glyph name="production" className="text-10" />
            Go to Production
          </Link>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The three views
// ---------------------------------------------------------------------------

const NoSynopsisButton = ({ onClick }: { readonly onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-[7px] rounded-chrome border border-dashed border-line bg-hover px-[10px] py-[8px] text-left text-11 text-ink3 hover:border-accent-line hover:bg-accent-bg"
  >
    No synopsis yet · write one
  </button>
)

const CardsView = ({
  scenes,
  synopsisOf,
  selected,
  scale,
  onSelect,
  onEdit,
  productionHref,
}: {
  readonly scenes: readonly SceneCard[]
  readonly synopsisOf: (card: SceneCard) => string | null
  readonly selected: NodeId | null
  readonly scale: number
  readonly onSelect: (id: NodeId) => void
  readonly onEdit: (id: NodeId) => void
  readonly productionHref: EpisodeRoutePath
}) => {
  const cardW = Math.round(340 * scale)
  const gap = Math.round(22 * scale)
  const previewH = Math.round(150 * scale)
  const grid = Math.round(22 * scale)
  return (
    <div
      className="h-full overflow-auto bg-desk pb-[32px] pl-[24px] pr-[64px] pt-[60px]"
      style={{
        scrollSnapType: 'x proximity',
        scrollPaddingLeft: 24,
        backgroundImage: 'radial-gradient(var(--grid) 1px, transparent 1px)',
        backgroundSize: `${String(grid)}px ${String(grid)}px`,
        backgroundPosition: '8px 8px',
      }}
    >
      <div className="flex min-w-min items-start" style={{ gap }}>
        {scenes.map((card) => {
          const isSel = card.derived.sceneNodeId === selected
          const synopsis = synopsisOf(card)
          return (
            <article
              key={card.derived.sceneNodeId}
              data-scene-card={card.derived.sceneNodeId}
              data-scene-number={card.derived.number}
              onClick={() => {
                onSelect(card.derived.sceneNodeId)
              }}
              className={`flex flex-none cursor-default flex-col overflow-hidden rounded-chrome border bg-panel hover:border-ink ${
                isSel ? 'border-accent-line' : 'border-line'
              }`}
              style={{ width: cardW, scrollSnapAlign: 'start' }}
            >
              <div className={`h-[3px] flex-none ${isSel ? 'bg-accent' : 'bg-ink'}`} />

              <div
                className="relative ml-[12px] mr-[12px] mt-[12px] overflow-hidden rounded-sheet border border-sheet-edge bg-sheet px-[18px] py-[14px] font-mono text-6-5 leading-[1.6] text-sheet-ink"
                style={{ height: previewH }}
              >
                <ExcerptLines lines={card.excerpt.lines} limit={CARD_EXCERPT_LINES} className="" />
                <span
                  className="absolute bottom-0 left-0 right-0 h-[34px]"
                  style={{ background: 'linear-gradient(to bottom, transparent, var(--sheet))' }}
                />
                <span
                  className="tabular absolute right-[10px] top-[8px] font-mono text-7 text-ink3"
                  data-scene-page
                >
                  pg {pageLabel(card)}
                </span>
              </div>

              <div className="flex flex-col gap-[10px] px-[13px] pb-[13px] pt-[12px]">
                <div className="flex items-baseline gap-[8px]">
                  <span className="flex-none font-serif text-20 font-medium leading-none text-ink3">
                    {sceneNo(card.derived.number)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-14 font-bold uppercase tracking-[.01em]">
                    {card.derived.heading}
                  </span>
                </div>

                <div className="flex flex-wrap gap-[6px]">
                  <Stat glyph="characters" title="Cast size">
                    {count(card.derived.castSize)} chars
                  </Stat>
                  <Stat glyph="notes" title="Dialogue lines">
                    {count(card.derived.lines)} lines
                  </Stat>
                  <Stat glyph="script" title="Page eighths">
                    <span data-scene-eighths>{eighthsLabel(card)}</span>
                  </Stat>
                </div>

                {hasSynopsis(synopsis) ? (
                  <p className="m-0 text-11-5 leading-[1.55] text-ink2">{synopsis}</p>
                ) : (
                  <NoSynopsisButton
                    onClick={() => {
                      onEdit(card.derived.sceneNodeId)
                    }}
                  />
                )}

                {card.cast.length === 0 ? null : (
                  <div className="flex flex-wrap gap-[6px]">
                    {card.cast.map((member) => (
                      <CastChip key={member.id} name={member.name} />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-[6px] border-t border-line2 px-[12px] pb-[12px] pt-[10px]">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onEdit(card.derived.sceneNodeId)
                  }}
                  className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-line bg-transparent px-[8px] py-[6px] text-11-5 text-ink2 hover:bg-hover hover:text-ink"
                >
                  <Glyph name="writing" className="text-10 opacity-70" />
                  Edit
                </button>
                <Link
                  href={productionHref}
                  onClick={(event) => {
                    event.stopPropagation()
                  }}
                  className="flex flex-1 items-center justify-center gap-[6px] whitespace-nowrap rounded-chrome border border-accent-line px-[8px] py-[6px] text-11-5 font-medium text-accent no-underline hover:bg-accent-bg hover:no-underline"
                >
                  <Glyph name="production" className="text-10" />
                  Go to Production
                </Link>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

const IndexView = ({
  scenes,
  synopsisOf,
  selected,
  onSelect,
}: {
  readonly scenes: readonly SceneCard[]
  readonly synopsisOf: (card: SceneCard) => string | null
  readonly selected: NodeId | null
  readonly onSelect: (id: NodeId) => void
}) => (
  <div
    className="h-full overflow-auto bg-desk px-[24px] pb-[40px] pt-[22px]"
    style={{
      backgroundImage: 'radial-gradient(var(--grid) 1px, transparent 1px)',
      backgroundSize: '22px 22px',
      backgroundPosition: '8px 8px',
    }}
  >
    <div
      className="grid min-w-[790px] items-start gap-[18px]"
      style={{ gridTemplateColumns: 'repeat(3, minmax(250px, 1fr))' }}
    >
      {scenes.map((card) => {
        const isSel = card.derived.sceneNodeId === selected
        const synopsis = synopsisOf(card)
        return (
          <article
            key={card.derived.sceneNodeId}
            data-index-card={card.derived.sceneNodeId}
            onClick={() => {
              onSelect(card.derived.sceneNodeId)
            }}
            className={`relative flex cursor-pointer flex-col rounded-sheet border bg-sheet transition-[transform,border-color] hover:-translate-y-[2px] hover:rotate-0 hover:border-ink ${
              isSel ? 'border-accent-line' : 'border-line'
            }`}
            style={{ transform: `rotate(${card.derived.number % 2 === 1 ? '-0.6' : '0.5'}deg)` }}
          >
            <div className="flex items-center gap-[8px] border-b border-sheet-line bg-sel px-[12px] py-[9px] text-ink">
              <span className="font-serif text-16 font-medium leading-none">
                {sceneNo(card.derived.number)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-11 font-bold uppercase">
                {card.derived.heading}
              </span>
            </div>
            <div
              className="flex flex-col gap-[9px] px-[12px] pb-[10px] pt-[12px]"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to bottom, transparent 0 21px, var(--sheet-line) 21px 22px)',
                backgroundPosition: '0 8px',
              }}
            >
              <p
                className={`m-0 min-h-[66px] font-serif text-14 leading-[22px] ${
                  hasSynopsis(synopsis) ? 'text-sheet-ink' : 'text-ink3'
                }`}
              >
                {hasSynopsis(synopsis) ? synopsis : 'No synopsis yet — open the scene and write one.'}
              </p>
              <div className="flex flex-wrap items-center gap-[6px] bg-sheet pt-[4px]">
                <span className="whitespace-nowrap rounded-chrome bg-hover px-[6px] py-[1px] text-9-5 text-ink2">
                  {card.derived.reading.ie} · {timeLabel(card)}
                </span>
                <span className="tabular whitespace-nowrap font-mono text-9-5 text-ink3">
                  {eighthsLabel(card)} · pg {pageLabel(card)}
                </span>
                <span className="ml-auto flex flex-wrap justify-end gap-[4px]">
                  {card.cast.map((member) => (
                    <span key={member.id} className="whitespace-nowrap text-9-5 text-accent">
                      @{member.name}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  </div>
)

const ListView = ({
  scenes,
  synopsisOf,
  selected,
  onSelect,
}: {
  readonly scenes: readonly SceneCard[]
  readonly synopsisOf: (card: SceneCard) => string | null
  readonly selected: NodeId | null
  readonly onSelect: (id: NodeId) => void
}) => (
  <div className="h-full overflow-auto">
    <div className="min-w-[960px]">
      <div className="sticky top-0 z-[5] flex items-center gap-[12px] border-b border-line bg-panel px-[16px] py-[9px] text-9-5 font-semibold uppercase tracking-label text-ink3">
        <span className="w-[28px] flex-none">#</span>
        <span className="w-[260px] flex-none">Heading</span>
        <span className="w-[56px] flex-none">I/E</span>
        <span className="w-[66px] flex-none">Time</span>
        <span className="w-[56px] flex-none">Pages</span>
        <span className="w-[56px] flex-none">Lines</span>
        <span className="w-[150px] flex-none">Cast</span>
        <span className="min-w-0 flex-1">Description</span>
        <span className="w-[70px] flex-none text-right">Status</span>
      </div>
      {scenes.map((card) => {
        const isSel = card.derived.sceneNodeId === selected
        const synopsis = synopsisOf(card)
        return (
          <div
            key={card.derived.sceneNodeId}
            role="button"
            tabIndex={0}
            data-scene-row={card.derived.sceneNodeId}
            onClick={() => {
              onSelect(card.derived.sceneNodeId)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(card.derived.sceneNodeId)
              }
            }}
            className={`flex cursor-pointer items-center gap-[12px] border-b border-line2 px-[16px] py-[12px] hover:bg-hover ${
              isSel ? 'bg-accent-bg' : ''
            }`}
          >
            <span className="w-[28px] flex-none font-serif text-16 text-ink3">
              {sceneNo(card.derived.number)}
            </span>
            <span className="w-[260px] flex-none truncate font-mono text-12 font-bold uppercase">
              {card.derived.heading}
            </span>
            <span className="w-[56px] flex-none font-mono text-11-5 text-ink2">
              {card.derived.reading.ie}
            </span>
            <span className="w-[66px] flex-none truncate font-mono text-11-5 text-ink2">
              {timeLabel(card)}
            </span>
            <span className="tabular w-[56px] flex-none font-mono text-11 text-ink2" data-scene-eighths>
              {eighthsLabel(card)}
            </span>
            <span className="tabular w-[56px] flex-none font-mono text-11 text-ink2">
              {count(card.derived.lines)}
            </span>
            <span className="flex w-[150px] flex-none flex-wrap gap-[5px]">
              {card.cast.map((member) => (
                <CastChip key={member.id} name={member.name} small />
              ))}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-11-5 leading-[1.45] ${
                hasSynopsis(synopsis) ? 'text-ink2' : 'text-ink3'
              }`}
            >
              {hasSynopsis(synopsis) ? synopsis : 'No synopsis yet'}
            </span>
            <span
              className={`w-[70px] flex-none text-right text-10 ${
                hasSynopsis(synopsis) ? 'text-add' : 'text-note'
              }`}
            >
              {hasSynopsis(synopsis) ? 'Ready' : 'Draft'}
            </span>
          </div>
        )
      })}
    </div>
  </div>
)

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.4
const ZOOM_STEP = 0.1

export const SceneBoard = ({
  view,
  projectId,
  episode,
  routeTag,
  productionHref,
  scenes,
  totalPages,
  measured,
  stale,
  unaccepted,
}: Props) => {
  const [selected, setSelected] = useState<NodeId | null>(null)
  const [focusEditor, setFocusEditor] = useState(false)
  const [scale, setScale] = useState(1)
  const [saved, setSaved] = useState<Readonly<Record<string, string | null>>>({})
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)

  const synopsisOf = useCallback(
    (card: SceneCard): string | null =>
      card.derived.sceneNodeId in saved
        ? (saved[card.derived.sceneNodeId] ?? null)
        : card.derived.synopsis,
    [saved],
  )

  const select = useCallback((id: NodeId) => {
    setSelected(id)
    setFocusEditor(false)
  }, [])
  const edit = useCallback((id: NodeId) => {
    setSelected(id)
    setFocusEditor(true)
  }, [])
  const close = useCallback(() => {
    setSelected(null)
    setFocusEditor(false)
  }, [])
  const onSaved = useCallback((id: NodeId, synopsis: string | null) => {
    setSaved((current) => ({ ...current, [id]: synopsis }))
    setLastSavedAt(Date.now())
  }, [])

  const current = useMemo(
    () => (selected === null ? null : (scenes.find((card) => card.derived.sceneNodeId === selected) ?? null)),
    [scenes, selected],
  )

  const zoom = (delta: number) => {
    setScale((value) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((value + delta) * 100) / 100)))
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-scene-board data-scene-count={scenes.length}>
      {measured && !stale ? null : (
        <div
          className="flex flex-none items-center gap-[8px] border-b border-line2 bg-note-bg px-[14px] py-[6px] text-10-5 text-ink2"
          data-measurement-notice
        >
          <span className="h-[6px] w-[6px] flex-none rounded-full bg-note" />
          {measured
            ? 'The measurement record is older than the script: pages and eighths below were measured against an earlier draft and are shown as recorded, not recomputed.'
            : 'This script has no measurement record yet. Pages and eighths show — until it is paginated; nothing here estimates them.'}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {view === 'cards' ? (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-[14px] right-0 top-0 z-[3] w-[56px]"
              style={{ background: 'linear-gradient(to right, transparent, var(--desk))' }}
            />
            <div
              className="absolute right-[14px] top-[12px] z-[4] flex items-center gap-[1px] rounded-chrome border border-line bg-panel p-[3px]"
              role="toolbar"
              aria-label="Card size"
            >
              <button
                type="button"
                title="Fit to content"
                onClick={() => {
                  setScale(1)
                }}
                className="grid h-[26px] place-items-center rounded-chrome bg-transparent px-[7px] text-10-5 text-ink2 hover:bg-hover"
              >
                Fit
              </button>
              <button
                type="button"
                title="Zoom out"
                onClick={() => {
                  zoom(-ZOOM_STEP)
                }}
                className="grid h-[26px] w-[28px] place-items-center rounded-chrome bg-transparent text-12 text-ink2 hover:bg-hover"
              >
                &minus;
              </button>
              <button
                type="button"
                title="Zoom in"
                onClick={() => {
                  zoom(ZOOM_STEP)
                }}
                className="grid h-[26px] w-[28px] place-items-center rounded-chrome bg-transparent text-12 text-ink2 hover:bg-hover"
              >
                <Glyph name="create" />
              </button>
            </div>
            <CardsView
              scenes={scenes}
              synopsisOf={synopsisOf}
              selected={selected}
              scale={scale}
              onSelect={select}
              onEdit={edit}
              productionHref={productionHref}
            />
          </>
        ) : view === 'index' ? (
          <IndexView scenes={scenes} synopsisOf={synopsisOf} selected={selected} onSelect={select} />
        ) : (
          <ListView scenes={scenes} synopsisOf={synopsisOf} selected={selected} onSelect={select} />
        )}
      </div>

      {unaccepted.length === 0 ? null : (
        <div className="flex-none border-t border-line2 bg-panel px-[14px] py-[8px]">
          <UnacceptedList unaccepted={unaccepted} />
        </div>
      )}

      <footer className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2">
        <span className="flex-none whitespace-nowrap" data-scene-footer-count>
          {count(scenes.length)} scene{scenes.length === 1 ? '' : 's'} ·{' '}
          <b className="font-semibold text-ink">{totalPages === null ? ABSENT : count(totalPages)}</b>{' '}
          pages
        </span>
        <span className="flex-none text-ink3">·</span>
        <span className="flex-none whitespace-nowrap">{VIEW_LABEL[view]}</span>
        <span className="flex-none text-ink3">·</span>
        <span className="min-w-0 truncate whitespace-nowrap">
          {current === null
            ? 'No scene selected'
            : `Scene ${sceneNo(current.derived.number)} · ${current.derived.heading}`}
        </span>
        <div className="min-w-0 flex-1" />
        {view === 'cards' ? (
          <span className="tabular flex-none whitespace-nowrap rounded-chrome border border-line2 px-[7px] py-[2px] text-10 text-ink2">
            {String(Math.round(scale * 100))}%
          </span>
        ) : null}
        {lastSavedAt === null ? null : (
          <span className="flex flex-none items-center gap-[5px] whitespace-nowrap">
            <span className="h-[6px] w-[6px] rounded-full bg-add" />
            synopsis saved
          </span>
        )}
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeTag}</span>
      </footer>

      {current === null ? null : (
        <DetailCard
          key={current.derived.sceneNodeId}
          card={current}
          synopsis={synopsisOf(current)}
          focusEditor={focusEditor}
          projectId={projectId}
          episode={episode}
          productionHref={productionHref}
          onClose={close}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
