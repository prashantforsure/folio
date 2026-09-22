'use client'

import type { Reel, ReelShot } from '@folio/contracts'
import { SHOT_STATUS_LABELS } from '@folio/contracts'
import type { DragEvent as ReactDragEvent } from 'react'

import { cameraLine, secondsLabel } from '../../../../../../lib/production/camera'
import { segmentTone, shotStatusOf } from '../../../../../../lib/production/derive'
import { STATUS_TONE } from '../../../../../../lib/production/menus'
import { Description } from './description'
import { useProduction } from './production-context'

/**
 * §3.3, a shot card on the recessed ground: the numbered badge (segment
 * colour), the duration pill, the status button (pulsing dot while
 * Generating), the select checkbox and delete; the mono camera line; the
 * description runs; the refusal banner when blocked; the three attribute
 * chips. Click opens the drawer; drag reorders; `Alt+↑` / `Alt+↓` with the
 * card focused move it a place (the keyboard path for the drag).
 */
export const ShotCard = ({
  reel,
  shot,
  over,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  readonly reel: Reel
  readonly shot: ReelShot
  readonly over: boolean
  readonly onDragOver: (event: ReactDragEvent) => void
  readonly onDragLeave: () => void
  readonly onDrop: (event: ReactDragEvent) => void
}) => {
  const { act, picked, detail, dragging, shown, scenes } = useProduction()
  const status = shotStatusOf(shot)
  const index = reel.shots.findIndex((candidate) => candidate.id === shot.id)
  const selected = picked.has(shot.id)
  const open = detail === shot.id
  const cast = shot.characters
    .map((entry) => scenes.flatMap((scene) => scene.cast).find((member) => member.id === entry.characterId)?.name)
    .filter((name): name is string => name !== undefined)
  const castLabel = cast.length === 0 ? 'No character' : cast.join(', ')

  const nudge = (delta: -1 | 1): void => {
    const target = index + delta
    if (target < 0 || target >= reel.shots.length) return
    const before = delta < 0 ? reel.shots[target] : reel.shots[target + 1]
    act.moveShot(shot.id, reel.id, before?.id ?? null)
  }

  return (
    <article
      data-shot-card={shot.id}
      data-shot-number={index + 1}
      data-status={status}
      data-selected={selected ? 'true' : undefined}
      data-open={open ? 'true' : undefined}
      data-over={over ? 'true' : undefined}
      data-dragging={dragging === shot.id ? 'true' : undefined}
      draggable
      tabIndex={0}
      role="button"
      aria-label={`Shot ${String(index + 1)}: ${shot.description || 'no description'}`}
      onDragStart={(event) => {
        event.stopPropagation()
        event.dataTransfer.effectAllowed = 'move'
        act.setDragging(shot.id)
      }}
      onDragEnd={() => {
        act.setDragging(null)
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => {
        act.openDetail(shot.id)
      }}
      onKeyDown={(event) => {
        if (event.altKey && event.key === 'ArrowUp') {
          event.preventDefault()
          nudge(-1)
        } else if (event.altKey && event.key === 'ArrowDown') {
          event.preventDefault()
          nudge(1)
        } else if (event.key === 'Enter' && event.target === event.currentTarget) {
          act.openDetail(shot.id)
        }
      }}
      className="folio-prod-shot"
    >
      <div className="flex items-center gap-[8px]">
        <span className="folio-prod-badge" data-tone={segmentTone(index)}>
          {String(index + 1)}
        </span>
        {shown('duration') ? (
          <button
            type="button"
            aria-label={`Duration ${secondsLabel(shot.durationS)}`}
            aria-haspopup="menu"
            data-shot-duration
            onClick={(event) => {
              act.openMenu('duration', { kind: 'shot', id: shot.id }, event)
            }}
            className="folio-prod-durpill"
          >
            <svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="9" cy="9" r="6.4" />
              <path d="M9 5.4V9l2.4 1.6" />
            </svg>
            {secondsLabel(shot.durationS)}
          </button>
        ) : null}
        <span className="flex-1" />
        {shown('status') ? (
          <button
            type="button"
            aria-label={`Status: ${SHOT_STATUS_LABELS[status]}`}
            aria-haspopup="menu"
            data-shot-status
            onClick={(event) => {
              act.openMenu('status', { kind: 'shot', id: shot.id }, event)
            }}
            className="folio-prod-status"
          >
            <span className="folio-prod-dot" data-tone={STATUS_TONE[status]} data-pulse={status === 'generating' ? 'true' : undefined} />
            {SHOT_STATUS_LABELS[status]}
            <span className="folio-prod-caret">▾</span>
          </button>
        ) : null}
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          title="Select shot"
          aria-label={`Select shot ${String(index + 1)}`}
          data-shot-select
          onClick={(event) => {
            event.stopPropagation()
            act.togglePick(shot.id)
          }}
          className="folio-prod-check"
        >
          ✓
        </button>
        <button
          type="button"
          title="Remove shot"
          aria-label={`Remove shot ${String(index + 1)}`}
          data-shot-delete
          onClick={(event) => {
            event.stopPropagation()
            act.deleteShot(shot.id)
          }}
          className="folio-prod-trash"
        >
          <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M3.8 5.2h10.4M7.4 5.2V3.6h3.2v1.6M5.4 5.2l.7 9.2h5.8l.7-9.2" />
          </svg>
        </button>
      </div>

      <span className="folio-prod-camline">{cameraLine(shot)}</span>

      {shown('desc') ? <Description parts={shot.parts} /> : null}

      {shot.blocked ? (
        <span className="folio-prod-refusal" role="alert" data-shot-refusal>
          <span>{shot.blockReason}</span>
          <button
            type="button"
            data-suggest-rewrite
            onClick={(event) => {
              event.stopPropagation()
              act.suggestRewrite(shot)
            }}
            className="folio-prod-linklike"
          >
            Suggest rewrite
          </button>
        </span>
      ) : null}

      <div className="flex flex-wrap gap-[6px]">
        {shown('type') ? (
          <button
            type="button"
            aria-label={`Shot type: ${shot.shotType}`}
            aria-haspopup="menu"
            data-shot-type
            onClick={(event) => {
              act.openMenu('type', { kind: 'shot', id: shot.id }, event)
            }}
            className="folio-prod-attr"
          >
            <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="5" width="9.5" height="8" rx="1.6" />
              <path d="M11.5 8.4L16 6.2v5.6l-4.5-2.2z" />
            </svg>
            {shot.shotType}
            <span className="folio-prod-caret">▾</span>
          </button>
        ) : null}
        {shown('motion') ? (
          <button
            type="button"
            aria-label={`Camera movement: ${shot.cameraMotion}`}
            aria-haspopup="menu"
            data-shot-motion
            onClick={(event) => {
              act.openMenu('motion', { kind: 'shot', id: shot.id }, event)
            }}
            className="folio-prod-attr"
          >
            <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              <path d="M9 2.4v13.2M2.4 9h13.2M4.6 4.6l2.4 2.4M13.4 13.4l-2.4-2.4M13.4 4.6l-2.4 2.4M4.6 13.4l2.4-2.4" />
            </svg>
            {shot.cameraMotion}
            <span className="folio-prod-caret">▾</span>
          </button>
        ) : null}
        {shown('cast') ? (
          <button
            type="button"
            aria-label={`Character: ${castLabel}`}
            aria-haspopup="menu"
            data-shot-cast
            data-empty={cast.length === 0 ? 'true' : undefined}
            onClick={(event) => {
              act.openMenu('cast', { kind: 'shot', id: shot.id }, event)
            }}
            className="folio-prod-attr"
          >
            <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              <circle cx="9" cy="6.6" r="2.6" />
              <path d="M4 14.6c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6" />
            </svg>
            {castLabel}
            <span className="folio-prod-caret">▾</span>
          </button>
        ) : null}
      </div>
    </article>
  )
}
