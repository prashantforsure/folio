'use client'

import type { FrameState, ShotEdit, ShotRow } from '@folio/contracts'
import type { InlineContent, LabelBook, MentionLabel } from '@folio/script'
import {
  CAMERA_ANGLES,
  CAMERA_ANGLE_LABEL,
  SHOT_MOVEMENTS,
  SHOT_MOVEMENT_LABEL,
  SHOT_SIZES,
  SHOT_SIZE_LABEL,
  isCameraAngle,
  isShotMovement,
  isShotSize,
} from '@folio/script'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { contentToText, textToContent } from '../../../../../../lib/storyboard/mentions'
import { ABSENT } from '../../../../../../lib/workspace/format'

/**
 * The pieces a shot is drawn from, shared by the three views.
 *
 *   `Description`   inline content rendered with `@mention` chips - the
 *                   label from the book, `@?` when a record is missing, the
 *                   same rule the Scenes excerpt uses.
 *   `FrameTile`     the 16:9 frame in all seven states. The bundle draws
 *                   two (drawn, empty); the other five are the job's
 *                   statuses and each is built, with the cost named on the
 *                   button before it is spent and the refusal reason shown
 *                   when a frame is blocked.
 *   `ShotEditor`    the whole spec, edited in place. Every field the brief
 *                   lists: size, movement, angle, lens, duration, description.
 *
 * Labels for the closed vocabularies are the pure core's own tables; nothing
 * here spells a size twice.
 */

export const sizeShort = (shot: ShotRow): string => SHOT_SIZE_LABEL[shot.size].short
export const sizeName = (shot: ShotRow): string => SHOT_SIZE_LABEL[shot.size].name
export const lensLabel = (lensMm: number | null): string => (lensMm === null ? ABSENT : `${String(lensMm)}mm`)
export const durationLabel = (seconds: number | null): string => (seconds === null ? ABSENT : `${String(seconds)}s`)

export const Description = ({ content, book }: { readonly content: InlineContent; readonly book: LabelBook }) => (
  <>
    {content.map((run, index) =>
      run.kind === 'text' ? (
        <span key={index}>{run.text}</span>
      ) : (
        <span key={index} className="rounded-[2px] bg-accent-bg px-[3px] text-accent" data-mention={run.target.entity}>
          @{book.labelFor(run.target) ?? '?'}
        </span>
      ),
    )}
  </>
)

/** The `@Name` chips under a canvas node - every mention in the description, once each. */
export const mentionChips = (content: InlineContent, book: LabelBook): readonly string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const run of content) {
    if (run.kind !== 'mention') continue
    const label = `@${book.labelFor(run.target) ?? '?'}`
    if (seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

const Grid = () => (
  <span
    aria-hidden
    className="pointer-events-none absolute inset-0"
    style={{
      backgroundImage:
        'linear-gradient(to right, rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.07) 1px, transparent 1px)',
      backgroundSize: '33.34% 33.34%',
    }}
  />
)

const frameLabel = (frame: FrameState): string => {
  switch (frame.kind) {
    case 'empty':
      return 'empty'
    case 'queued':
      return 'queued'
    case 'running':
      return 'drawing'
    case 'drawn':
      return 'drawn'
    case 'failed':
      return 'failed'
    case 'blocked':
      return 'refused'
    case 'cancelled':
      return 'cancelled'
  }
}

/**
 * The frame, 16:9, in whichever state the job row says. `onDraw` names the
 * cost on the button; `onCancel` is offered while the job can still be
 * stopped. A proposal has no frame to draw and gets no button.
 */
export const FrameTile = ({
  shot,
  cost,
  available,
  pending,
  onDraw,
  onCancel,
  compact = false,
  children,
}: {
  readonly shot: ShotRow
  readonly cost: number
  readonly available: number
  readonly pending: boolean
  readonly onDraw: () => void
  readonly onCancel: (jobId: string) => void
  /** The canvas node's tile: no number, no drag handle, states as text. */
  readonly compact?: boolean
  /** Overlaid at the top-left: the `WS · 24mm` badge. */
  readonly children?: ReactNode
}) => {
  const { frame } = shot
  const proposed = shot.state === 'proposed'
  const drawLabel = frame.kind === 'drawn' || frame.kind === 'failed' || frame.kind === 'blocked' ? 'Redraw' : 'Draw frame'
  const short = available < cost
  const drawButton = proposed ? null : (
    <button
      type="button"
      data-draw-frame
      data-cost={cost}
      disabled={pending}
      title={short ? `${String(available)} credits available · ${String(cost)} needed` : `Reserves ${String(cost)} credits · ${String(available)} available`}
      onClick={onDraw}
      className={`folio-focus flex items-center gap-[5px] rounded-chrome px-[8px] py-[3px] text-10-5 font-medium disabled:opacity-60 ${
        frame.kind === 'drawn' ? 'bg-[rgba(0,0,0,.38)] text-[rgba(255,255,255,.85)]' : 'bg-accent-bg text-accent'
      }`}
    >
      <span className="font-glyph text-9">✦</span>
      {drawLabel} · {cost} cr
    </button>
  )
  const cancelButton =
    frame.kind === 'queued' || frame.kind === 'running' ? (
      <button
        type="button"
        data-cancel-frame
        disabled={pending}
        onClick={() => {
          onCancel(frame.jobId)
        }}
        className="folio-small-button disabled:opacity-60"
      >
        {frame.kind === 'queued' ? 'Cancel' : 'Stop'}
      </button>
    ) : null

  if (frame.kind === 'drawn') {
    return (
      <div
        data-frame={frameLabel(frame)}
        className="relative aspect-video overflow-hidden rounded-chrome"
        style={{ background: 'linear-gradient(160deg, var(--frame-a), var(--frame-b))' }}
      >
        <Grid />
        {/* A plain img: the frame is at a URL the worker wrote, not an asset Next can optimise. */}
        <img src={frame.url} alt={`Frame for shot ${shot.number}`} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute left-[9px] top-[8px]">{children}</div>
        {compact ? null : (
          <span className="absolute bottom-[10px] left-[10px] font-serif text-15 font-medium text-white">SHOT {shot.number}</span>
        )}
        <div className="absolute bottom-[8px] right-[8px]">{drawButton}</div>
      </div>
    )
  }

  const tone =
    frame.kind === 'failed' || frame.kind === 'blocked'
      ? 'border-del bg-del-bg'
      : frame.kind === 'queued' || frame.kind === 'running'
        ? 'border-note bg-note-bg'
        : proposed
          ? 'border-dashed border-note bg-note-bg'
          : 'border-dashed border-line bg-hover'

  return (
    <div
      data-frame={frameLabel(frame)}
      className={`relative flex aspect-video flex-col items-center justify-center gap-[4px] overflow-hidden rounded-chrome border p-[8px] text-center ${tone}`}
    >
      <div className="absolute left-[9px] top-[8px]">{children}</div>
      {compact ? null : <span className="font-serif text-15 font-medium">SHOT {shot.number}</span>}
      {proposed ? (
        <span className="text-10-5 font-medium text-note">Proposed · accept to board</span>
      ) : frame.kind === 'empty' ? (
        drawButton
      ) : frame.kind === 'queued' ? (
        <>
          <span className="flex items-center gap-[5px] text-10-5 font-medium text-note">
            <span className="h-[6px] w-[6px] rounded-full bg-note" />
            Queued · {frame.cost} credits reserved
          </span>
          <span className="max-w-[26ch] text-9-5 leading-[1.4] text-ink3">Waiting for a worker. It survives a closed tab.</span>
          {cancelButton}
        </>
      ) : frame.kind === 'running' ? (
        <>
          <span className="flex items-center gap-[5px] text-10-5 font-medium text-note">
            <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-note" />
            Drawing…
          </span>
          {cancelButton}
        </>
      ) : frame.kind === 'failed' ? (
        <>
          <span className="text-10-5 font-medium text-del">Failed{frame.refunded ? ' · refunded' : ' · not yet refunded'}</span>
          {frame.error === null ? null : <span className="max-w-[28ch] text-9-5 leading-[1.4] text-ink2">{frame.error}</span>}
          {drawButton}
        </>
      ) : frame.kind === 'blocked' ? (
        <>
          <span className="text-10-5 font-medium text-del">Refused</span>
          <span className="max-w-[28ch] text-9-5 leading-[1.4] text-ink2" data-blocked-reason>
            {frame.reason}
          </span>
          {drawButton}
        </>
      ) : (
        <>
          <span className="text-10-5 font-medium text-ink3">Cancelled · reservation released</span>
          {drawButton}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

const Field = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-[3px]">
    <span className="text-9 font-semibold uppercase tracking-label text-ink3">{label}</span>
    {children}
  </label>
)

const control =
  'folio-focus w-full rounded-chrome border border-line2 bg-sheet px-[7px] py-[4px] text-11 text-ink'

/**
 * Every field of the spec, whole. The description is edited as text and
 * parsed back to inline content through the label book (`mentions.ts`), so
 * `@Meera` becomes a reference and `@Nobody` stays text.
 */
export const ShotEditor = ({
  shot,
  labels,
  book,
  pending,
  onSave,
  onCancel,
}: {
  readonly shot: ShotEdit
  readonly labels: readonly MentionLabel[]
  readonly book: LabelBook
  readonly pending: boolean
  readonly onSave: (edit: ShotEdit) => void
  readonly onCancel: () => void
}) => {
  const [size, setSize] = useState(shot.size)
  const [movement, setMovement] = useState(shot.movement)
  const [angle, setAngle] = useState(shot.angle)
  const [lens, setLens] = useState(shot.lensMm === null ? '' : String(shot.lensMm))
  const [duration, setDuration] = useState(shot.durationSeconds === null ? '' : String(shot.durationSeconds))
  const [description, setDescription] = useState(contentToText(shot.description, book))

  const asInt = (raw: string): number | null => {
    const trimmed = raw.trim()
    if (trimmed === '') return null
    const value = Number(trimmed)
    return Number.isInteger(value) ? value : null
  }

  return (
    <form
      data-shot-editor
      className="flex flex-col gap-[8px] rounded-chrome border border-accent-line bg-panel p-[10px]"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({
          size,
          movement,
          angle,
          lensMm: asInt(lens),
          durationSeconds: asInt(duration),
          description: textToContent(description, labels),
        })
      }}
    >
      <div className="grid grid-cols-3 gap-[8px]">
        <Field label="Shot size">
          <select
            data-field="size"
            value={size}
            className={control}
            onChange={(event) => {
              if (isShotSize(event.target.value)) setSize(event.target.value)
            }}
          >
            {SHOT_SIZES.map((value) => (
              <option key={value} value={value}>
                {SHOT_SIZE_LABEL[value].name} ({SHOT_SIZE_LABEL[value].short})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Movement">
          <select
            data-field="movement"
            value={movement}
            className={control}
            onChange={(event) => {
              if (isShotMovement(event.target.value)) setMovement(event.target.value)
            }}
          >
            {SHOT_MOVEMENTS.map((value) => (
              <option key={value} value={value}>
                {SHOT_MOVEMENT_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Camera">
          <select
            data-field="angle"
            value={angle}
            className={control}
            onChange={(event) => {
              if (isCameraAngle(event.target.value)) setAngle(event.target.value)
            }}
          >
            {CAMERA_ANGLES.map((value) => (
              <option key={value} value={value}>
                {CAMERA_ANGLE_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lens (mm)">
          <input
            data-field="lens"
            type="number"
            inputMode="numeric"
            min={8}
            max={1200}
            step={1}
            value={lens}
            placeholder="—"
            className={control}
            onChange={(event) => {
              setLens(event.target.value)
            }}
          />
        </Field>
        <Field label="Duration (s)">
          <input
            data-field="duration"
            type="number"
            inputMode="numeric"
            min={0}
            max={3600}
            step={1}
            value={duration}
            placeholder="—"
            className={control}
            onChange={(event) => {
              setDuration(event.target.value)
            }}
          />
        </Field>
      </div>
      <Field label="Description · @mention a character or location">
        <textarea
          data-field="description"
          rows={3}
          value={description}
          className={`${control} resize-y leading-[1.5]`}
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
      </Field>
      <div className="flex items-center justify-end gap-[6px]">
        <button type="button" className="folio-small-button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="submit"
          data-save-shot
          disabled={pending}
          className="folio-focus rounded-chrome bg-accent px-[10px] py-[4px] text-10-5 font-semibold text-accent-ink disabled:opacity-60"
        >
          Save shot
        </button>
      </div>
    </form>
  )
}
