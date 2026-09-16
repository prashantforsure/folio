'use client'

import type { ShotRow, StoryboardScene } from '@folio/contracts'
import { CAMERA_ANGLE_LABEL, SHOT_MOVEMENT_LABEL } from '@folio/script'
import { Icon } from '@folio/ui'
import type { ReactElement } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { isDrawn, shotStateLabel, shotTone } from '../../../../../../lib/storyboard/board'
import { useDismiss } from '../_chrome/use-dismiss'
import type { ViewProps } from './handlers'
import {
  BLANK_SHOT,
  Description,
  FrameTile,
  NoShots,
  ShotEditor,
  TONE_DOT,
  drawLabel,
  drawTitle,
  editorActionsFor,
  frameNotice,
  lensLabel,
  mentionChips,
  sizeName,
  sizeShort,
} from './shot-parts'

/**
 * The canvas: the selected scene's shots as nodes in a row on a dotted
 * ground - `docs/ui design/Route - Storyboard v2.dc.html`, "CANVAS". A
 * node is 306px, `--sunk`, a 14px radius, the `--shade` shadow, its border
 * `--line` once drawn; the header is the status dot, `Shot 01-01` and the
 * mono state; then the 158px frame with the `WS · 24mm` badge; the tag
 * chips (size, camera, movement); the description, three lines; the
 * `@mention` chips; and the footer - `Generate` / `Regenerate` beside `⋯`.
 * Nodes are linked by a 44px hairline and a chevron. After the last, the
 * dashed `+ Add shot node`. Bottom-left, the zoom pill: `−`, the
 * percentage, `+`, a rule, `Fit`.
 *
 * ## Which scene
 *
 * The selected one - picked in the sidebar's `Boards` group or on the
 * board; the toolbar's count names it. The mockup draws its first scene.
 *
 * ## Zoom is a scale
 *
 * The strip is laid out at 100% and scaled with a transform; the wrapper
 * takes the scaled size so the ground still scrolls. `Fit` picks the
 * largest scale, up to 100%, at which the whole strip fits the ground's
 * width. Component state, per the session README - a zoom is a window's.
 *
 * ## `⋯`
 *
 * Edit, Move left / right, Remove - and for a proposal, Accept / Discard.
 * The node's main button is the frame job: `Generate · N cr`, `Regenerate ·
 * N cr`, `Cancel` while queued, `Stop` while running; a proposal's is
 * `Accept`, because a proposal has no frame.
 */

const ZOOM_STEPS = [50, 60, 70, 80, 90, 100, 110, 125, 150] as const
const ZOOM_MAX = 150

export const CanvasView = ({ view }: { readonly view: ViewProps }) => {
  const scene = view.scenes.find((entry) => entry.sceneNodeId === view.selected) ?? null
  const ground = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(100)
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const shots = scene === null ? [] : scene.shots.filter(view.visible)

  useLayoutEffect(() => {
    const node = strip.current
    if (node === null) return undefined
    const measure = (): void => {
      setSize({ width: node.offsetWidth, height: node.offsetHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [scene?.sceneNodeId, shots.length, adding, editing])

  const fit = useCallback(() => {
    if (ground.current === null || size === null || size.width === 0) return
    const scale = Math.min(1, ground.current.clientWidth / size.width)
    setZoom(Math.max(ZOOM_STEPS[0], Math.round(scale * 100)))
  }, [size])

  const step = (direction: 1 | -1): void => {
    setZoom((current) => {
      const next = direction === 1 ? ZOOM_STEPS.find((value) => value > current) : [...ZOOM_STEPS].reverse().find((value) => value < current)
      return next ?? current
    })
  }

  const scale = zoom / 100

  return (
    <div data-shot-canvas className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={ground} className="folio-canvas-ground min-h-0 flex-1 overflow-auto">
        {scene === null ? (
          <p className="m-0 p-[28px] text-12-5 text-ink3">Pick a scene in the sidebar to open its canvas.</p>
        ) : scene.shots.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <NoShots
              pending={view.pending}
              onPropose={() => {
                view.handlers.onPropose(scene.sceneNodeId)
              }}
            />
          </div>
        ) : (
          <div
            style={size === null ? undefined : { width: size.width * scale, height: size.height * scale }}
            className="min-w-min"
          >
            <div
              ref={strip}
              data-canvas-strip
              data-zoom={zoom}
              style={{ transform: `scale(${String(scale)})`, transformOrigin: 'top left' }}
              className="flex w-max items-center gap-0 pb-[84px] pl-[24px] pr-[24px] pt-[28px]"
            >
              {shots.length === 0 ? <p className="m-0 text-12-5 text-ink3">No shots match this filter.</p> : null}
              {shots.map((shot, index) => (
                <ShotNode
                  key={shot.id}
                  shot={shot}
                  scene={scene}
                  index={index}
                  count={scene.shots.length}
                  view={view}
                  linked={index > 0}
                  editing={editing === shot.id}
                  onEdit={() => {
                    setEditing(shot.id)
                  }}
                  onClose={() => {
                    setEditing(null)
                  }}
                />
              ))}
              <span className="flex w-[44px] flex-none items-center">
                <span className="h-[1px] flex-1 bg-line2" />
              </span>
              {adding ? (
                <div data-add-shot-form className="folio-shot-node flex w-[306px] flex-none flex-col">
                  <ShotEditor
                    shot={BLANK_SHOT}
                    title="New shot"
                    labels={view.labels}
                    book={view.book}
                    pending={view.pending}
                    onCancel={() => {
                      setAdding(false)
                    }}
                    onSave={(edit) => {
                      view.handlers.onAdd(scene.sceneNodeId, edit)
                      setAdding(false)
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  data-add-shot
                  disabled={view.pending}
                  className="folio-new-scene flex h-[200px] w-[180px] flex-none flex-col items-center justify-center gap-[8px] rounded-[14px] border border-dashed border-line bg-transparent text-13 text-ink3 disabled:opacity-60"
                  onClick={() => {
                    setAdding(true)
                  }}
                >
                  <span className="text-18 leading-none">+</span>Add shot node
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div data-zoom-pill className="absolute bottom-[18px] left-[20px] flex items-center gap-[2px] rounded-pill border border-line bg-sunk p-[4px] shadow-[0_12px_34px_var(--shade)]">
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={zoom <= ZOOM_STEPS[0]}
          className="folio-ghost-button grid h-[30px] w-[30px] place-items-center rounded-full text-15 leading-none text-ink2 disabled:opacity-40"
          onClick={() => {
            step(-1)
          }}
        >
          −
        </button>
        <span className="tabular min-w-[48px] text-center font-mono text-11-5 text-ink2" data-zoom-label>
          {zoom}%
        </span>
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={zoom >= ZOOM_MAX}
          className="folio-ghost-button grid h-[30px] w-[30px] place-items-center rounded-full text-15 leading-none text-ink2 disabled:opacity-40"
          onClick={() => {
            step(1)
          }}
        >
          +
        </button>
        <span className="mx-[3px] h-[18px] w-[1px] bg-line" />
        <button type="button" data-zoom-fit className="folio-ghost-button h-[30px] rounded-pill px-[11px] text-12-5 text-ink2" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A node
// ---------------------------------------------------------------------------

const ShotNode = ({
  shot,
  scene,
  index,
  count,
  view,
  linked,
  editing,
  onEdit,
  onClose,
}: {
  readonly shot: ShotRow
  readonly scene: StoryboardScene
  readonly index: number
  readonly count: number
  readonly view: ViewProps
  readonly linked: boolean
  readonly editing: boolean
  readonly onEdit: () => void
  readonly onClose: () => void
}) => {
  const proposed = shot.state === 'proposed'
  const inFlight = shot.frame.kind === 'queued' || shot.frame.kind === 'running'
  const badge = `${sizeShort(shot)} · ${lensLabel(shot.lensMm)}`
  const notice = frameNotice(shot)
  const { handlers, cost, available, pending } = view

  return (
    <>
      {linked ? (
        <span className="flex w-[44px] flex-none items-center" aria-hidden>
          <span className="h-[1px] flex-1 bg-line" />
          <Icon name="chevron" size={10} strokeWidth={1.4} className="-ml-[2px] flex-none text-ink3" style={{ transform: 'rotate(-90deg)' }} />
        </span>
      ) : null}
      <div
        data-shot-node={shot.id}
        data-shot-state={shot.state}
        data-shot-number={shot.number}
        className={`folio-shot-node flex w-[306px] flex-none flex-col ${isDrawn(shot) ? 'border-line' : 'border-line2'}`}
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
            <div className="flex items-center gap-[9px] pb-[10px] pl-[12px] pr-[12px] pt-[11px]">
              <span className={`h-[7px] w-[7px] flex-none rounded-full ${TONE_DOT[shotTone(shot)]}`} />
              <span className="min-w-0 flex-1 truncate text-13-5 font-medium">Shot {shot.number}</span>
              <span className="flex-none font-mono text-10-5 text-ink3" data-node-state>
                {shotStateLabel(shot)}
              </span>
            </div>

            {view.display.frames ? <FrameTile shot={shot} size="node" badge={badge} /> : null}

            <div className="flex flex-col gap-[9px] pl-[12px] pr-[12px] pt-[11px]">
              <div className="flex flex-wrap gap-[5px]">
                {[sizeName(shot), CAMERA_ANGLE_LABEL[shot.angle], SHOT_MOVEMENT_LABEL[shot.movement]].map((tag) => (
                  <span key={tag} className="whitespace-nowrap rounded-pill border border-line2 bg-s1 px-[8px] py-[3px] text-11 text-ink2">
                    {tag}
                  </span>
                ))}
              </div>
              {view.display.descriptions && shot.description.length > 0 ? (
                <p className="folio-clamp-3 m-0 text-12-5 leading-[1.55] text-ink2" data-shot-description>
                  <Description content={shot.description} book={view.book} />
                </p>
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
                  disabled={pending}
                  title={drawTitle(cost, available)}
                  className="folio-pill-button flex-1 rounded-[10px] px-[10px] py-[9px] text-12-5 disabled:opacity-60"
                  onClick={() => {
                    handlers.onDraw(shot.id)
                  }}
                >
                  {isDrawn(shot) ? 'Regenerate' : 'Generate'} · {cost} cr
                </button>
              )}
              <NodeMenu
                shot={shot}
                index={index}
                count={count}
                pending={pending}
                onEdit={onEdit}
                onMove={(direction) => {
                  handlers.onMove(shot.id, direction)
                }}
                onRemove={() => {
                  handlers.onDiscard(scene.sceneNodeId, shot.id)
                }}
                drawLabel={proposed || inFlight ? null : drawLabel(shot, cost)}
                onDraw={() => {
                  handlers.onDraw(shot.id)
                }}
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}

const NodeMenu = ({
  shot,
  index,
  count,
  pending,
  onEdit,
  onMove,
  onRemove,
  drawLabel: draw,
  onDraw,
}: {
  readonly shot: ShotRow
  readonly index: number
  readonly count: number
  readonly pending: boolean
  readonly onEdit: () => void
  readonly onMove: (direction: 'up' | 'down') => void
  readonly onRemove: () => void
  readonly drawLabel: string | null
  readonly onDraw: () => void
}) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), root)
  const item = (label: string, attrs: Readonly<Record<`data-${string}`, string>>, act: () => void, disabled = false, tone = ''): ReactElement => (
    <button
      type="button"
      role="menuitem"
      {...attrs}
      disabled={pending || disabled}
      className={`folio-menu-item ${tone}`}
      onClick={() => {
        setOpen(false)
        act()
      }}
    >
      {label}
    </button>
  )
  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        title="Node actions"
        aria-label="Node actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-node-menu
        className="folio-pill-button grid h-full w-[34px] place-items-center rounded-[10px] text-15 leading-none !text-ink3"
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        ⋯
      </button>
      {open ? (
        <div role="menu" className="folio-menu absolute bottom-[40px] right-0 w-[200px]">
          {item('Edit', { 'data-edit-shot': '' }, onEdit)}
          {item('Move left', { 'data-move-shot': 'up' }, () => onMove('up'), index === 0)}
          {item('Move right', { 'data-move-shot': 'down' }, () => onMove('down'), index >= count - 1)}
          {draw === null ? null : item(draw, { 'data-draw-frame': '' }, onDraw)}
          <div className="mt-[2px] border-t border-line2 pt-[4px]">
            {shot.state === 'proposed'
              ? item('Discard', { 'data-discard-shot': '' }, onRemove, false, '!text-live')
              : item('Remove', { 'data-delete-shot': '' }, onRemove, false, '!text-live')}
          </div>
        </div>
      ) : null}
    </div>
  )
}
