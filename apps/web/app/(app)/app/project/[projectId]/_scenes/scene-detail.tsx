'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'

import { saveSynopsis } from '../../../../../../lib/scenes/actions'
import type { SynopsisResult } from '../../../../../../lib/scenes/result'
import type { SceneCard } from '../../../../../../lib/scenes/server'
import { ABSENT, count } from '../../../../../../lib/workspace/format'
import { setQueueIntent } from '../../../../../../lib/characters/compose'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { characterHref, locationHref, projectRouteHref, propHref } from '../../../../../../lib/workspace/hrefs'
import { CastChip, eighthsLabel, pageRange, sceneNo, timeLabel } from './scene-parts'

/**
 * The scene's edit surface: `Edit` on a card, or `No synopsis yet · write
 * one`. A dialog over the canvas - the client ruled (2026-09-11) that a
 * scene opens in place, never at a `/scenes/:sceneId` - on the reading
 * modal's ground: the same scrim and blur, a `--sunk` panel where the
 * modal's is paper, because this one is chrome and that one is the page.
 *
 * Head: `01`, the heading, ✕. Body: the derived fields in a grid, the cast,
 * the synopsis editor. Foot: `Read the scene` (hands over to the reading
 * modal) and `Go to Production`. Portalled to `body` for the reason the
 * reading modal gives. Escape and the scrim close it.
 *
 * ## The one write
 *
 * The synopsis, through `saveSynopsis` to `scenes.synopsis` and nowhere
 * near the node list. After a save the server revalidates and the new
 * value arrives in props; `onSaved` is the transient copy the workspace
 * shows until it does. Every other field here is read and printed.
 */

const Field = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-[3px]">
    <span className="folio-eyebrow">{label}</span>
    <span className="tabular min-w-0 truncate font-mono text-12-5 text-ink">{children}</span>
  </div>
)

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

  const save = (): void => {
    start(async () => {
      const outcome = await saveSynopsis({ projectId, episode, sceneNodeId: card.derived.sceneNodeId, synopsis: draft })
      setResult(outcome)
      if (outcome.status === 'saved') onSaved(card.derived.sceneNodeId, outcome.synopsis)
    })
  }

  return (
    <div className="flex flex-col gap-[7px]" data-synopsis-editor>
      <div className="flex items-baseline gap-[8px]">
        <span className="folio-eyebrow">Synopsis</span>
        <span className="text-10-5 text-ink3">authored · kept through every re-derive</span>
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
        className="folio-field w-full resize-y text-13 leading-[1.55]"
      />
      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="folio-solid-button h-[32px] rounded-[10px] px-[13px] text-12-5 font-medium disabled:opacity-45"
        >
          {pending && result === null ? 'Saving…' : 'Save synopsis'}
        </button>
        {result === null ? null : (
          <span className={`text-11-5 ${result.status === 'saved' ? 'text-ok' : 'text-live'}`} role="status">
            {result.status === 'saved' ? 'Saved to the scene record' : result.message}
          </span>
        )}
      </div>
    </div>
  )
}

export const SceneDetail = ({
  card,
  synopsis,
  focusEditor,
  projectId,
  episode,
  productionHref,
  onClose,
  onRead,
  onSaved,
}: {
  readonly card: SceneCard
  readonly synopsis: string | null
  readonly focusEditor: boolean
  readonly projectId: ProjectId
  readonly episode: EpisodeSlug
  readonly productionHref: EpisodeRoutePath
  readonly onClose: () => void
  readonly onRead: () => void
  readonly onSaved: (sceneNodeId: NodeId, synopsis: string | null) => void
}) => {
  const [mounted, setMounted] = useState(false)
  const headingId = useId()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const nameOf = new Map(card.cast.map((member) => [member.id, member.name]))
  const speaking = card.derived.speaking.map((id) => ({ id, name: nameOf.get(id) ?? '(record missing)' }))
  const mentioned = card.derived.mentioned.map((id) => ({ id, name: nameOf.get(id) ?? '(record missing)' }))

  if (!mounted) return null
  return createPortal(
    <div
      className="folio-modal-scrim"
      data-scene-detail={card.derived.sceneNodeId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="flex max-h-full w-full max-w-[640px] flex-col overflow-hidden rounded-panel border border-line bg-sunk shadow-[0_30px_90px_var(--panel-shadow)]"
      >
        <div className="flex flex-none items-center gap-[10px] px-[18px] pb-[12px] pt-[16px]">
          <span className="flex-none font-mono text-12 text-ink3">{sceneNo(card.derived.number)}</span>
          <h2 id={headingId} className="m-0 min-w-0 flex-1 truncate font-mono text-13 uppercase tracking-[.01em]">
            {card.derived.heading}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="folio-ghost-button grid h-[28px] w-[28px] flex-none place-items-center rounded-[8px] text-ink3">
            <Icon name="close" size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-auto px-[18px] pb-[18px]">
          <div className="grid grid-cols-4 gap-[12px]">
            <Field label="Int / Ext">{card.derived.reading.ie}</Field>
            <Field label="Set">
              {card.derived.reading.set === '' ? (
                ABSENT
              ) : card.derived.locationId === null ? (
                card.derived.reading.set
              ) : (
                <Link href={locationHref(projectId, card.derived.locationId)} data-scene-set-link className="text-ink no-underline hover:text-accent hover:underline">
                  {card.derived.reading.set}
                </Link>
              )}
            </Field>
            <Field label="Time">{timeLabel(card)}</Field>
            <Field label="Light">{card.derived.reading.light}</Field>
            <Field label="Page">{pageRange(card)}</Field>
            <Field label="Eighths">{eighthsLabel(card)}</Field>
            <Field label="Lines on the page">{card.measured === null ? ABSENT : count(card.measured.lines)}</Field>
            <Field label="Dialogue nodes">{count(card.derived.lines)}</Field>
          </div>
          {card.measured === null ? (
            <p className="m-0 text-11-5 leading-[1.5] text-ink3">
              Page, eighths and lines on the page come from the measurement record, and this script has no measurement yet. Nothing here estimates them.
            </p>
          ) : null}

          <div className="flex flex-col gap-[7px]">
            <span className="folio-eyebrow">Cast · {count(card.derived.castSize)}</span>
            <div className="flex flex-wrap items-center gap-[6px]">
              {speaking.map((person, index) => (
                <CastChip key={`s-${String(index)}`} name={person.name} href={characterHref(projectId, person.id)} />
              ))}
              {mentioned.length === 0 ? null : <span className="text-10-5 text-ink3">mentioned</span>}
              {mentioned.map((person, index) => (
                <CastChip key={`m-${String(index)}`} name={person.name} href={characterHref(projectId, person.id)} small />
              ))}
              {card.derived.castSize === 0 ? <span className="text-11-5 text-ink3">Nobody speaks or is mentioned.</span> : null}
            </div>
          </div>

          <div className="flex flex-col gap-[7px]" data-scene-props={card.props.length}>
            <span className="folio-eyebrow">Props · {count(card.props.length)}</span>
            <div className="flex flex-wrap items-center gap-[6px]">
              {card.props.map((prop) => (
                <Link
                  key={prop.id}
                  href={propHref(projectId, prop.id)}
                  data-scene-prop={prop.id}
                  className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline"
                >
                  {prop.name}
                </Link>
              ))}
              {card.props.length === 0 ? (
                <span className="text-11-5 text-ink3">
                  No prop reads in this scene. A prop is a record on{' '}
                  <Link href={projectRouteHref(projectId, 'props')} data-props-link className="text-ink3 underline hover:text-accent">
                    Props
                  </Link>
                  , matched by the spellings the page uses.
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-[7px]">
            {card.derived.unresolvedCues.length === 0 ? null : (
              <p className="m-0 text-11-5 leading-[1.5] text-warn">
                {count(card.derived.unresolvedCues.length)} cue{card.derived.unresolvedCues.length === 1 ? '' : 's'} not yet matched to a record:{' '}
                <span className="font-mono">{card.derived.unresolvedCues.join(', ')}</span>. Resolve them on{' '}
                <Link
                  href={projectRouteHref(projectId, 'characters')}
                  data-resolve-link
                  className="text-warn underline hover:text-ink"
                  onClick={() => {
                    setQueueIntent('rows')
                  }}
                >
                  Characters
                </Link>
                .
              </p>
            )}
          </div>

          <SynopsisEditor projectId={projectId} episode={episode} card={card} value={synopsis} autoFocus={focusEditor} onSaved={onSaved} />
        </div>

        <div className="flex flex-none items-center gap-[8px] border-t border-line2 px-[18px] py-[12px]">
          <button type="button" data-detail-read className="folio-pill-button flex h-[32px] items-center gap-[7px] rounded-[10px] px-[12px] text-12-5" onClick={onRead}>
            <Icon name="write" size={13} strokeWidth={1.5} className="opacity-70" />
            Read the scene
          </button>
          <div className="flex-1" />
          <Link href={productionHref} className="folio-pill-button flex h-[32px] items-center gap-[7px] rounded-[10px] px-[12px] text-12-5 no-underline hover:no-underline">
            <Icon name="production" size={14} strokeWidth={1.5} className="opacity-70" />
            Go to Production
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  )
}
