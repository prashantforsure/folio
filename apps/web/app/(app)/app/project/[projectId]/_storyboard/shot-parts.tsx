'use client'

import type { ShotEdit, ShotRow } from '@folio/contracts'
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

import { shotStateLabel, shotTone } from '../../../../../../lib/storyboard/board'
import type { Tone } from '../../../../../../lib/storyboard/board'
import { contentToText, textToContent } from '../../../../../../lib/storyboard/mentions'
import { ABSENT } from '../../../../../../lib/workspace/format'
import type { ViewProps } from './handlers'

/**
 * The pieces a shot is drawn from, shared by the three views - `docs/ui
 * design/Route - Storyboard v2.dc.html`, transcribed.
 *
 *   `Description`   inline content with `@mention` chips - the label from
 *                   the book, `@?` when a record is missing, the same rule
 *                   the Scenes excerpt uses.
 *   `FrameTile`     the frame at the three sizes the mockup draws it: the
 *                   board card's 104×59, the canvas node's 158px, the list
 *                   row's 120×68. Two states in the mockup - drawn (the
 *                   `--frame-a → --frame-b` gradient under a 3×3 grid) and
 *                   empty (a dashed tile reading `no frame`); the other
 *                   five are the job's statuses and each is the dashed tile
 *                   with the state in mono, coloured by `shotTone`.
 *   `ShotEditor`    the whole spec, edited in place. Every field: size,
 *                   movement, angle, lens, duration, description. The
 *                   footer is the README's drawer footer - the destructive
 *                   action on the left, Cancel / Save on the right.
 *
 * Labels for the closed vocabularies are the pure core's own tables; nothing
 * here spells a size twice.
 */

export const sizeShort = (shot: ShotRow): string => SHOT_SIZE_LABEL[shot.size].short
export const sizeName = (shot: ShotRow): string => SHOT_SIZE_LABEL[shot.size].name
export const lensLabel = (lensMm: number | null): string => (lensMm === null ? ABSENT : `${String(lensMm)}mm`)
export const durationLabel = (seconds: number | null): string => (seconds === null ? ABSENT : `${String(seconds)}s`)

export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  live: 'bg-live',
  none: 'bg-ink3',
}

export const TONE_INK: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  live: 'text-live',
  none: 'text-ink3',
}

export const Description = ({ content, book }: { readonly content: InlineContent; readonly book: LabelBook }) => (
  <>
    {content.map((run, index) =>
      run.kind === 'text' ? (
        <span key={index}>{run.text}</span>
      ) : (
        <span key={index} className="rounded-[4px] bg-accent-bg px-[3px] text-accent" data-mention={run.target.entity}>
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

export type FrameSize = 'card' | 'node' | 'row'

const FRAME_BOX: Record<FrameSize, string> = {
  card: 'w-[104px] h-[59px] rounded-[8px]',
  node: 'mx-[12px] h-[158px] rounded-[10px]',
  row: 'w-[120px] h-[68px] rounded-[8px]',
}

/**
 * The frame in whichever state the job row says. `badge` is what the node
 * overlays top-left (`WS · 24mm`); the card and the row draw none. A drawn
 * frame is the picture over the gradient; everything else is the dashed
 * tile with the state in mono.
 */
export const FrameTile = ({ shot, size, badge }: { readonly shot: ShotRow; readonly size: FrameSize; readonly badge?: string }) => {
  const { frame } = shot
  const label = shotStateLabel(shot)
  const tone = shotTone(shot)
  const block = size === 'node' ? 'block' : 'flex-none'

  if (frame.kind === 'drawn' || frame.kind === 'uploaded') {
    return (
      <span data-frame={frame.kind} className={`folio-frame relative ${block} overflow-hidden ${FRAME_BOX[size]}`}>
        <span aria-hidden className="folio-frame-grid absolute inset-0" />
        {/* A plain img: the frame is at a URL the worker or the upload wrote, not an asset Next can optimise. */}
        <img src={frame.url} alt={`Frame for shot ${shot.number}`} className="absolute inset-0 h-full w-full object-cover" />
        {badge === undefined ? null : (
          <span className="absolute left-[8px] top-[7px] rounded-[6px] bg-frame-badge px-[7px] py-[3px] font-mono text-9-5 text-frame-badge-ink">{badge}</span>
        )}
      </span>
    )
  }

  return (
    <span
      data-frame={label}
      className={`relative ${block} grid place-items-center border border-dashed border-line bg-s1 ${FRAME_BOX[size]}`}
    >
      {size === 'node' ? <span aria-hidden className="folio-frame-grid-faint absolute inset-0 rounded-[10px]" /> : null}
      {badge === undefined ? null : <span className="absolute left-[8px] top-[7px] font-mono text-9-5 text-ink3">{badge}</span>}
      <span className={`relative font-mono ${size === 'node' ? 'text-12-5' : size === 'card' ? 'text-9' : 'text-9-5'} ${TONE_INK[tone]}`}>
        {size === 'node' && frame.kind === 'empty' ? 'No board yet' : label}
      </span>
    </span>
  )
}

/** Why a frame failed or was refused, in the writer's terms - shown wherever the shot is, never hidden in a tooltip. */
export const frameNotice = (shot: ShotRow): string | null => {
  switch (shot.frame.kind) {
    case 'blocked':
      return `Refused: ${shot.frame.reason}`
    case 'failed':
      return `${shot.frame.error ?? 'The frame failed.'}${shot.frame.refunded ? ' Refunded.' : ' Not yet refunded.'}`
    case 'queued':
      return `Queued · ${String(shot.frame.cost)} credits reserved. It survives a closed tab.`
    case 'running':
      return 'Drawing…'
    case 'cancelled':
      return 'Cancelled · reservation released.'
    case 'empty':
    case 'drawn':
    case 'uploaded':
      return null
  }
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

const Field = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-[5px]">
    <span className="folio-eyebrow">{label}</span>
    {children}
  </label>
)

export type EditorAction = {
  readonly label: string
  readonly onClick: () => void
  /** `data-*` attributes for the walk: `{ "data-draw-frame": "", "data-cost": "4" }`. */
  readonly attrs: Readonly<Record<`data-${string}`, string>>
  readonly disabled?: boolean
  readonly title?: string
}

/** `Draw frame · 4 cr`, `Redraw · 4 cr` - the cost named on the button before it is spent. */
export const drawLabel = (shot: ShotRow, cost: number): string =>
  `${shot.frame.kind === 'drawn' || shot.frame.kind === 'failed' || shot.frame.kind === 'blocked' ? 'Redraw' : 'Draw frame'} · ${String(cost)} cr`

/**
 * The editor's footer for a shot: what can be undone on the left, what can
 * be done beside Save. A proposal discards or accepts; a shot removes, and
 * draws its frame or stops the job drawing it.
 */
export const editorActionsFor = (
  shot: ShotRow,
  view: Pick<ViewProps, 'cost' | 'drawOff' | 'handlers'>,
): { readonly destructive: EditorAction; readonly secondary: EditorAction } => {
  const { handlers, cost, drawOff } = view
  if (shot.state === 'proposed') {
    return {
      destructive: {
        label: 'Discard',
        attrs: { 'data-discard-shot': '' },
        onClick: () => {
          handlers.onDiscard(shot.sceneNodeId, shot.id)
        },
      },
      secondary: {
        label: 'Accept',
        attrs: { 'data-accept-shot': '' },
        onClick: () => {
          handlers.onAccept(shot.sceneNodeId, shot.id)
        },
      },
    }
  }
  const destructive: EditorAction = {
    label: 'Remove',
    attrs: { 'data-delete-shot': '' },
    title: 'Remove this shot',
    onClick: () => {
      handlers.onDiscard(shot.sceneNodeId, shot.id)
    },
  }
  if (shot.frame.kind === 'queued' || shot.frame.kind === 'running') {
    const { jobId } = shot.frame
    return {
      destructive,
      secondary: {
        label: shot.frame.kind === 'queued' ? 'Cancel frame' : 'Stop drawing',
        attrs: { 'data-cancel-frame': '' },
        onClick: () => {
          handlers.onCancelFrame(jobId)
        },
      },
    }
  }
  return {
    destructive,
    secondary: {
      label: drawLabel(shot, cost),
      attrs: { 'data-draw-frame': '', 'data-cost': String(cost) },
      // Off only where the server cannot draw (no model key, no storage); the worker draws it (roadmap task 4.3).
      ...(drawOff === null ? {} : { disabled: true, title: drawOff }),
      onClick: () => {
        handlers.onDraw(shot.id)
      },
    },
  }
}

/**
 * Every field of the spec, whole. The description is edited as text and
 * parsed back to inline content through the label book (`mentions.ts`), so
 * `@Meera` becomes a reference and `@Nobody` stays text.
 *
 * `destructive` sits at the footer's left (Remove, Discard); `secondary`
 * beside Cancel (Draw frame · N cr, Accept). The README's drawer footer,
 * on a card.
 */
export const ShotEditor = ({
  shot,
  title,
  labels,
  book,
  pending,
  destructive,
  secondary,
  onSave,
  onCancel,
}: {
  readonly shot: ShotEdit
  /** `Shot 01-02`, or `New shot` while it has no number. */
  readonly title: string
  readonly labels: readonly MentionLabel[]
  readonly book: LabelBook
  readonly pending: boolean
  readonly destructive?: EditorAction
  readonly secondary?: EditorAction
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
      className="flex flex-col gap-[12px] p-[12px]"
      onClick={(event) => {
        event.stopPropagation()
      }}
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
      <span className="text-13-5 font-medium">{title}</span>
      <div className="grid grid-cols-2 gap-[8px]">
        <Field label="Shot size">
          <select
            data-field="size"
            value={size}
            className="folio-field folio-select"
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
            className="folio-field folio-select"
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
            className="folio-field folio-select"
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
        <div className="grid grid-cols-2 gap-[8px]">
          <Field label="Lens (mm)">
            <input
              data-field="lens"
              type="number"
              inputMode="numeric"
              min={8}
              max={1200}
              step={1}
              value={lens}
              placeholder={ABSENT}
              className="folio-field tabular font-mono"
              onChange={(event) => {
                setLens(event.target.value)
              }}
            />
          </Field>
          <Field label="Dur. (s)">
            <input
              data-field="duration"
              type="number"
              inputMode="numeric"
              min={0}
              max={3600}
              step={1}
              value={duration}
              placeholder={ABSENT}
              className="folio-field tabular font-mono"
              onChange={(event) => {
                setDuration(event.target.value)
              }}
            />
          </Field>
        </div>
      </div>
      <Field label="Description · @ a character or location">
        <textarea
          data-field="description"
          rows={3}
          value={description}
          className="folio-field resize-y leading-[1.5]"
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
      </Field>
      <div className="flex items-center gap-[6px] border-t border-line2 pt-[10px]">
        {destructive === undefined ? null : (
          <button
            type="button"
            {...destructive.attrs}
            disabled={pending || destructive.disabled === true}
            title={destructive.title}
            className="folio-ghost-button rounded-[8px] px-[9px] py-[6px] text-12-5 text-live disabled:opacity-60"
            onClick={destructive.onClick}
          >
            {destructive.label}
          </button>
        )}
        <div className="flex-1" />
        {secondary === undefined ? null : (
          <button
            type="button"
            {...secondary.attrs}
            disabled={pending || secondary.disabled === true}
            title={secondary.title}
            className="folio-pill-button rounded-[9px] px-[11px] py-[6px] text-12-5 disabled:opacity-60"
            onClick={secondary.onClick}
          >
            {secondary.label}
          </button>
        )}
        <button type="button" className="folio-ghost-button rounded-[8px] px-[9px] py-[6px] text-12-5 text-ink2" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="submit" data-save-shot disabled={pending} className="folio-solid-button rounded-[9px] px-[13px] py-[6px] text-12-5 font-medium">
          Save
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// New shots, and none
// ---------------------------------------------------------------------------

/** What `New shot` opens with: a static eye-level medium on a 50mm, nothing said yet. */
export const BLANK_SHOT: ShotEdit = {
  size: 'ms',
  movement: 'static',
  angle: 'eye_level',
  lensMm: 50,
  durationSeconds: null,
  description: [],
}

/**
 * A scene with no shots - the mockup's block: the dashed 132×74 grid, `No
 * shots yet`, one line of copy, and the solid `Auto board`. Drawn in the
 * board's column and on the canvas.
 */
export const NoShots = ({ pending, onPropose }: { readonly pending: boolean; readonly onPropose: () => void }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-[14px] px-[14px] py-[30px]" data-no-shots>
    <span className="relative h-[74px] w-[132px] overflow-hidden rounded-[10px] border border-dashed border-line bg-s1">
      <span aria-hidden className="folio-frame-grid-faint absolute inset-0" />
    </span>
    <span className="flex flex-col items-center gap-[5px] text-center">
      <span className="text-14 font-medium">No shots yet</span>
      <span className="max-w-[26ch] text-12-5 leading-[1.5] text-ink3">Auto board reads the scene text and proposes a first shot list.</span>
    </span>
    <button
      type="button"
      data-auto-board
      disabled={pending}
      className="folio-solid-button flex items-center gap-[7px] rounded-pill px-[15px] py-[9px] text-13 font-medium"
      onClick={(event) => {
        event.stopPropagation()
        onPropose()
      }}
    >
      Auto board
    </button>
  </div>
)
