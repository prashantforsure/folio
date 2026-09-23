'use client'

import type { ShotRow, StoryboardScene } from '@folio/contracts'
import { CAMERA_ANGLE_LABEL, SHOT_MOVEMENT_LABEL } from '@folio/script'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

import { isDrawn, shotEditOf, shotStateLabel, shotTone } from '../../../../../../../lib/storyboard/board'
import { NODE_W } from '../../../../../../../lib/storyboard/canvas'
import type { Point, Size } from '../../../../../../../lib/storyboard/canvas'
import { contentToText, textToContent } from '../../../../../../../lib/storyboard/mentions'
import type { ViewProps } from '../handlers'
import {
  Description,
  FrameTile,
  ShotEditor,
  TONE_DOT,
  editorActionsFor,
  frameNotice,
  lensLabel,
  mentionChips,
  sizeName,
  sizeShort,
} from '../shot-parts'
import { LensPanel } from './lens-panel'
import { NodeMenu } from './node-menu'

/**
 * One card on the canvas: 306px, `--sunk`, the `--shade` shadow, its
 * border `--line` once it has a picture. Absolutely placed in the world at
 * `position`; the view decides that from the row and the drag in flight.
 *
 * ## The grip
 *
 * The header row - dot, `Shot 01-02`, the mono state - is the grip. A
 * drag there moves the card (pointer capture, a 3px threshold so a click
 * is a click) and reports the world position live to the view, which
 * overlays it; on release, `onPlaceOnCanvas` writes it. Position is
 * cosmetic - the thread and the number still follow the sequence.
 *
 * ## Two tabs
 *
 * `Storyboard` (default): the frame and the description. `Lens`: the four
 * selects (`lens-panel.tsx`). The description is edited where it is - a
 * click turns it into a textarea; blur or Cmd+Enter saves through the
 * label book (`mentions.ts`), Escape leaves it - so the card never swaps
 * itself for a form to change one line. The long form (`ShotEditor`, with
 * the duration) is still `⋯ → Edit`.
 *
 * ## The footer
 *
 * The frame job: `Generate · N cr` / `Regenerate · N cr`, `Cancel` while
 * queued, `Stop` while running; a proposal's is `Accept`. Then `⋯`.
 */
export const ShotNode = ({
  shot,
  scene,
  index,
  count,
  view,
  position,
  scale,
  editing,
  dragging,
  onEdit,
  onClose,
  onDrag,
  onDrop,
  onMeasure,
}: {
  readonly shot: ShotRow
  readonly scene: StoryboardScene
  readonly index: number
  readonly count: number
  readonly view: ViewProps
  readonly position: Point
  /** The world's scale, to turn a pointer delta into world px. */
  readonly scale: number
  readonly editing: boolean
  readonly dragging: boolean
  readonly onEdit: () => void
  readonly onClose: () => void
  /** The card is under the pointer at this world position. */
  readonly onDrag: (position: Point | null) => void
  readonly onDrop: (position: Point) => void
  readonly onMeasure: (size: Size) => void
}) => {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ readonly pointerId: number; readonly startX: number; readonly startY: number; readonly from: Point; moved: boolean } | null>(null)
  const [tab, setTab] = useState<'storyboard' | 'lens'>('storyboard')
  const [draft, setDraft] = useState<string | null>(null)

  const proposed = shot.state === 'proposed'
  const inFlight = shot.frame.kind === 'queued' || shot.frame.kind === 'running'
  const badge = `${sizeShort(shot)} · ${lensLabel(shot.lensMm)}`
  const notice = frameNotice(shot)
  const { handlers, cost, pending } = view

  useLayoutEffect(() => {
    const node = root.current
    if (node === null) return undefined
    const measure = (): void => {
      onMeasure({ width: node.offsetWidth, height: node.offsetHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [onMeasure])

  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || pending) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: position, moved: false }
  }
  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (current === null || event.pointerId !== current.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < 3) return
    current.moved = true
    onDrag({ x: current.from.x + dx / scale, y: current.from.y + dy / scale })
  }
  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (current === null || event.pointerId !== current.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!current.moved) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    onDrag(null)
    onDrop({ x: Math.round(current.from.x + dx / scale), y: Math.round(current.from.y + dy / scale) })
  }

  const saveDraft = (): void => {
    if (draft === null) return
    const content = textToContent(draft, view.labels)
    setDraft(null)
    if (draft === contentToText(shot.description, view.book)) return
    handlers.onSave(shot.id, { ...shotEditOf(shot), description: content })
  }

  return (
    <div
      ref={root}
      data-shot-node={shot.id}
      data-shot-state={shot.state}
      data-shot-number={shot.number}
      data-canvas-x={position.x}
      data-canvas-y={position.y}
      data-dragging={dragging ? 'true' : undefined}
      style={{ left: position.x, top: position.y, width: NODE_W }}
      className={`folio-shot-node absolute flex flex-col ${isDrawn(shot) ? 'border-line' : 'border-line2'}`}
      onPointerDown={(event) => {
        // A press anywhere on the card is the card's, never the ground's pan.
        event.stopPropagation()
      }}
    >
      {editing ? (
        <ShotEditor
          shot={shot}
          title={`Shot ${shot.number}`}
          labels={view.labels}
          book={view.book}
          pending={pending}
          {...editorActionsFor(shot, view)}
          onCancel={onClose}
          onSave={(edit) => {
            handlers.onSave(shot.id, edit)
            onClose()
          }}
        />
      ) : (
        <>
          <div
            data-node-grip
            className="folio-node-grip flex items-center gap-[9px] pb-[8px] pl-[12px] pr-[12px] pt-[11px]"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
          >
            <span className={`h-[7px] w-[7px] flex-none rounded-full ${TONE_DOT[shotTone(shot)]}`} />
            <span className="min-w-0 flex-1 truncate text-13-5 font-medium">Shot {shot.number}</span>
            <span className="flex-none font-mono text-10-5 text-ink3" data-node-state>
              {shotStateLabel(shot)}
            </span>
          </div>

          <div role="tablist" aria-label={`Shot ${shot.number} tabs`} className="folio-node-tabs">
            {(['storyboard', 'lens'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-node-tab={id}
                className="folio-node-tab"
                onClick={() => {
                  setTab(id)
                }}
              >
                {id === 'storyboard' ? 'Storyboard' : 'Lens'}
              </button>
            ))}
          </div>

          {tab === 'lens' ? (
            <LensPanel
              shot={shot}
              pending={pending}
              onSave={(edit) => {
                handlers.onSave(shot.id, edit)
              }}
            />
          ) : (
            <>
              {view.display.frames ? <FrameTile shot={shot} size="node" badge={badge} /> : null}

              <div className="flex flex-col gap-[9px] pl-[12px] pr-[12px] pt-[11px]">
                <div className="flex flex-wrap gap-[5px]">
                  {[sizeName(shot), CAMERA_ANGLE_LABEL[shot.angle], SHOT_MOVEMENT_LABEL[shot.movement]].map((tag) => (
                    <span key={tag} className="whitespace-nowrap rounded-pill border border-line2 bg-s1 px-[8px] py-[3px] text-11 text-ink2">
                      {tag}
                    </span>
                  ))}
                </div>
                {view.display.descriptions ? (
                  draft !== null ? (
                    <textarea
                      autoFocus
                      data-description-editor
                      value={draft}
                      rows={4}
                      disabled={pending}
                      placeholder="What the camera sees. @ a character or a location."
                      className="folio-field w-full resize-none text-12-5 leading-[1.55]"
                      onChange={(event) => {
                        setDraft(event.target.value)
                      }}
                      onBlur={saveDraft}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setDraft(null)
                        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          saveDraft()
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      data-shot-description
                      title="Click to edit"
                      className={`folio-clamp-3 m-0 w-full cursor-text border-0 bg-transparent p-0 text-left text-12-5 leading-[1.55] ${shot.description.length === 0 ? 'text-ink3' : 'text-ink2'}`}
                      onClick={() => {
                        setDraft(contentToText(shot.description, view.book))
                      }}
                    >
                      {shot.description.length === 0 ? 'Describe the shot…' : <Description content={shot.description} book={view.book} />}
                    </button>
                  )
                ) : null}
                {notice === null ? null : (
                  <p className={`m-0 text-11-5 leading-[1.45] ${shot.frame.kind === 'failed' || shot.frame.kind === 'blocked' ? 'text-live' : 'text-ink3'}`} data-frame-notice>
                    {notice}
                  </p>
                )}
                {mentionChips(shot.description, view.book).length === 0 ? null : (
                  <div className="flex flex-wrap gap-[6px]">
                    {mentionChips(shot.description, view.book).map((chip) => (
                      <span key={chip} className="rounded-pill bg-accent-bg px-[8px] py-[2px] text-11 text-accent">
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex gap-[7px] p-[12px]">
            {proposed ? (
              <button
                type="button"
                data-accept-shot
                disabled={pending}
                className="folio-pill-button flex-1 rounded-[10px] px-[10px] py-[9px] text-12-5 disabled:opacity-60"
                onClick={() => {
                  handlers.onAccept(scene.sceneNodeId, shot.id)
                }}
              >
                Accept
              </button>
            ) : inFlight ? (
              <button
                type="button"
                data-cancel-frame
                disabled={pending}
                className="folio-pill-button flex-1 rounded-[10px] px-[10px] py-[9px] text-12-5 disabled:opacity-60"
                onClick={() => {
                  if (shot.frame.kind === 'queued' || shot.frame.kind === 'running') handlers.onCancelFrame(shot.frame.jobId)
                }}
              >
                {shot.frame.kind === 'queued' ? 'Cancel' : 'Stop'}
              </button>
            ) : (
              <button
                type="button"
                data-generate-frame
                data-cost={cost}
                disabled={pending || view.drawOff !== null}
                title={view.drawOff ?? undefined}
                className="folio-pill-button flex-1 rounded-[10px] px-[10px] py-[9px] text-12-5 disabled:opacity-60"
                onClick={() => {
                  handlers.onDraw(shot.id)
                }}
              >
                {shot.frame.kind === 'drawn' ? 'Regenerate' : 'Generate'} · {cost} cr
              </button>
            )}
            <NodeMenu
              shot={shot}
              index={index}
              count={count}
              pending={pending}
              storage={view.storage}
              onEdit={onEdit}
              onMove={(direction) => {
                handlers.onMove(shot.id, direction)
              }}
              onUpload={(file) => {
                handlers.onUploadFrame(shot.id, file)
              }}
              onClear={() => {
                handlers.onClearFrame(shot.id)
              }}
              onRemove={() => {
                handlers.onDiscard(scene.sceneNodeId, shot.id)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
