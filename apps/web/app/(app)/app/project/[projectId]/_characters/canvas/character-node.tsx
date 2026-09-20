'use client'

import { CHARACTER_GENDER_LABELS, PORTRAIT_TYPES } from '@folio/contracts'
import { Icon } from '@folio/ui'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useRef, useState } from 'react'

import { CHAR_NODE_W } from '../../../../../../../lib/characters/canvas'
import type { CastFigure } from '../../../../../../../lib/characters/cast'
import type { Point, Size } from '../../../../../../../lib/storyboard/canvas'
import { count } from '../../../../../../../lib/workspace/format'
import { useMeasure } from '../../_chrome/canvas/use-measure'
import { useNodeDrag } from '../../_chrome/canvas/use-node-drag'

/**
 * One character on the canvas (2026-09-20; redrawn 2026-09-21 - "Characters,
 * card and connector redesign" in `docs/build-decisions.md`): a shot node's
 * shape with a person in it. 306px, `--sunk`, the `--shade` shadow;
 * absolutely placed in the world at `position`, which the view decides
 * from the drag in flight and the positions it holds.
 *
 * ## Top to bottom
 *
 *   the tabs      `Portrait · Advanced · Look sheet` on the card's top edge,
 *                 component state (the URL never changes, the Characters
 *                 ruling). The active tab shares the card's surface.
 *   the face      a deep tint of the record's hue (`--face-*`) - or the
 *                 portrait under a scrim - with the name and `Male · 16`
 *                 printed white bottom-left. The scrim is on every face,
 *                 photo or not. The face is the grip: a drag moves the card
 *                 (pointer capture, a 3px threshold), a click opens the
 *                 drawer. `Advanced` and `Look sheet` draw it shorter.
 *   the chips     `12 scenes` · `40 lines` - the derivation's counts with an
 *                 icon each, zero printed as zero.
 *   the bio       two lines, or `No character bio yet`.
 *   the buttons   `Edit` · `Upload` side by side, then `✦ Generate` full
 *                 width - drawn **disabled** with `Needs the Production
 *                 worker`: the look-sheet job is Production's
 *                 (`docs/production/`), its cost must be named before it is
 *                 spent, and the worker is not built (the assistant
 *                 composer's precedent). `Upload` is disabled with its reason
 *                 when the `R2_*` block is unset.
 *   the grip      a ring of four dots at the end of the last row: drag onto
 *                 another card to make a relationship. The view owns that
 *                 drag (it has to know which card the pointer is over); the
 *                 grip only starts it.
 *
 * `Advanced` holds the costume & makeup prompt the look sheet will read, and
 * `Look sheet` its three angle slots; both are drawn empty and inert until
 * the worker exists - the prompt field is disabled with the same reason, so
 * nothing on the card pretends to keep what it cannot.
 *
 * Every value printed is read from `CastFigure` (`lib/characters/cast.ts`),
 * which names the table each came from; nothing on the card is computed.
 */
const GENERATE_DISABLED = 'Needs the Production worker'

type FaceTab = 'portrait' | 'advanced' | 'looksheet'
const TABS: readonly { readonly id: FaceTab; readonly label: string }[] = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'looksheet', label: 'Look sheet' },
]
const SLOTS = ['Front', 'Profile', 'Full'] as const

/** `Male · 16`, `16`, `Male`, or `—` with neither set. */
const subLine = (figure: Pick<CastFigure, 'gender' | 'age'>): string => {
  const parts = [figure.gender === null ? null : CHARACTER_GENDER_LABELS[figure.gender], figure.age === null || figure.age.trim() === '' ? null : figure.age.trim()]
  const shown = parts.filter((part): part is string => part !== null)
  return shown.length === 0 ? '—' : shown.join(' · ')
}

export const CharacterNode = ({
  figure,
  position,
  scale,
  selected,
  dragging,
  target,
  connecting,
  storage,
  onOpen,
  onDrag,
  onDrop,
  onMeasure,
  onConnectStart,
  onUpload,
}: {
  readonly figure: CastFigure
  readonly position: Point
  /** The world's scale, to turn a pointer delta into world px. */
  readonly scale: number
  readonly selected: boolean
  readonly dragging: boolean
  /** A connect-drag from another card is over this one. */
  readonly target: boolean
  /** This card's grip is the one being dragged. */
  readonly connecting: boolean
  readonly storage: boolean
  readonly onOpen: () => void
  readonly onDrag: (position: Point | null) => void
  readonly onDrop: (position: Point) => void
  readonly onMeasure: (size: Size) => void
  readonly onConnectStart: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onUpload: (file: File) => void
}) => {
  const root = useRef<HTMLElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<FaceTab>('portrait')
  useMeasure(root, onMeasure)
  const drag = useNodeDrag({ position, scale, onDrag, onDrop })

  const grip = (
    <button
      type="button"
      data-connect-grip
      data-active={connecting ? 'true' : undefined}
      title="Drag onto another character to add a relationship"
      aria-label={`Connect ${figure.name} to another character`}
      className="folio-connect-grip flex-none"
      onPointerDown={(event) => {
        event.stopPropagation()
        onConnectStart(event)
      }}
    >
      <span />
      <span />
      <span />
      <span />
    </button>
  )

  const generate = (label: string) => (
    <button
      type="button"
      data-generate="disabled"
      disabled
      title={GENERATE_DISABLED}
      aria-label={`${label} for ${figure.name} - ${GENERATE_DISABLED}`}
      className="folio-char-action flex-1"
    >
      <span className="folio-mark">✦</span>
      {label}
    </button>
  )

  return (
    <article
      ref={root}
      data-character-node={figure.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : undefined}
      data-target={target ? 'true' : undefined}
      data-face-tab={tab}
      data-canvas-x={position.x}
      data-canvas-y={position.y}
      aria-label={figure.name}
      style={{ left: position.x, top: position.y, width: CHAR_NODE_W, ['--cast-h' as string]: `var(--chip-${String(figure.hue)}-h)` }}
      className="folio-char-node absolute flex flex-col"
      onPointerDown={(event) => {
        // A press anywhere on the card is the card's, never the ground's pan.
        event.stopPropagation()
      }}
    >
      <div role="tablist" aria-label={`${figure.name} card face`} className="folio-char-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-face-tab-button={item.id}
            aria-selected={tab === item.id ? 'true' : 'false'}
            className="folio-char-tab"
            onClick={() => {
              setTab(item.id)
            }}
          >
            <i aria-hidden />
            {item.label}
          </button>
        ))}
      </div>

      <div className="folio-char-body">
        <div
          role="button"
          tabIndex={0}
          aria-label={`Open ${figure.name}`}
          data-node-face
          data-portrait={figure.portraitUrl === null ? 'false' : 'true'}
          data-short={tab === 'portrait' ? undefined : 'true'}
          className="folio-char-face"
          {...drag.handlers}
          onClick={() => {
            if (!drag.moved()) onOpen()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpen()
            }
          }}
        >
          {figure.portraitUrl === null ? null : <img src={figure.portraitUrl} alt="" draggable={false} />}
          {tab === 'portrait' ? (
            figure.portraitUrl === null ? (
              <span className="folio-char-hint" aria-hidden>
                <span className="folio-char-glyph">{figure.initial}</span>
                <span>{storage ? 'Upload a portrait, or fill in the details and generate one' : 'Fill in the details and generate a portrait'}</span>
              </span>
            ) : null
          ) : (
            <span className="folio-char-hint" aria-hidden>
              <Icon name={tab === 'advanced' ? 'characters' : 'cards'} size={26} strokeWidth={1.5} />
              <span>No look sheet yet</span>
            </span>
          )}
          <span className="folio-char-face-name">
            <span className="truncate" data-node-name>
              {figure.name}
            </span>
            {tab === 'portrait' ? (
              <span className="folio-char-face-sub" data-node-sub>
                {subLine(figure)}
              </span>
            ) : null}
          </span>
        </div>

        {tab === 'portrait' ? (
          <>
            <div className="flex flex-wrap gap-[6px]">
              <span className="folio-char-chip" data-node-scenes={figure.appearances} title="Scenes in the script">
                <Icon name="board" size={13} strokeWidth={1.6} />
                <b>{count(figure.appearances)}</b> {figure.appearances === 1 ? 'scene' : 'scenes'}
              </span>
              <span className="folio-char-chip" data-node-lines={figure.lines} title="Dialogue lines">
                <Icon name="comment" size={13} strokeWidth={1.6} />
                <b>{count(figure.lines)}</b> {figure.lines === 1 ? 'line' : 'lines'}
              </span>
            </div>
            {figure.bio === null || figure.bio.trim() === '' ? (
              <span className="folio-char-bio" data-node-bio="none">
                No character bio yet
              </span>
            ) : (
              <p className="folio-char-bio folio-clamp-2 m-0" data-node-bio style={{ textWrap: 'pretty' }}>
                {figure.bio}
              </p>
            )}
            <div className="flex gap-[8px]">
              <button
                type="button"
                data-node-edit
                className="folio-char-action flex-1"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpen()
                }}
              >
                <Icon name="write" size={14} strokeWidth={1.6} />
                Edit
              </button>
              <button
                type="button"
                data-node-upload
                disabled={!storage}
                title={storage ? 'Upload a portrait' : 'Portrait storage is not set up on this server yet.'}
                className="folio-char-action flex-1"
                onClick={(event) => {
                  event.stopPropagation()
                  picker.current?.click()
                }}
              >
                <Icon name="import" size={14} strokeWidth={1.6} />
                Upload
              </button>
              <input
                ref={picker}
                type="file"
                accept={PORTRAIT_TYPES.join(',')}
                aria-label={`Portrait for ${figure.name}`}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file !== undefined) onUpload(file)
                }}
              />
            </div>
            <div className="flex items-center gap-[8px]">
              {generate('Generate')}
              {grip}
            </div>
          </>
        ) : tab === 'advanced' ? (
          <>
            <label className="folio-char-label" htmlFor={`look-prompt-${figure.id}`}>
              Costume &amp; makeup prompt
            </label>
            <textarea
              id={`look-prompt-${figure.id}`}
              data-look-prompt
              className="folio-char-prompt"
              placeholder="Describe makeup, wardrobe, accessories, overall styling…"
              disabled
              title={GENERATE_DISABLED}
              rows={3}
            />
            <div className="flex items-center gap-[8px]">
              {generate('Generate look sheet')}
              {grip}
            </div>
          </>
        ) : (
          <>
            <span className="folio-char-label">Three kept angles, from the portrait and the prompt</span>
            <div className="grid grid-cols-3 gap-[6px]" data-look-slots>
              {SLOTS.map((slot) => (
                <span key={slot} className="folio-char-slot">
                  {slot}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-[8px]">
              {generate('Generate look sheet')}
              {grip}
            </div>
          </>
        )}
      </div>
    </article>
  )
}
