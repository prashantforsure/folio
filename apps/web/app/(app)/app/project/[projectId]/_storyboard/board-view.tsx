'use client'

import type { ShotRow, StoryboardScene } from '@folio/contracts'
import { SHOT_MOVEMENT_LABEL } from '@folio/script'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import type { DragEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { dayNight, isDrawn, sceneNo, sceneSlug, sceneTone, shotStateLabel, shotTone } from '../../../../../../lib/storyboard/board'
import { count } from '../../../../../../lib/workspace/format'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { ViewProps } from './handlers'
import { BLANK_SHOT, Description, NoShots, ShotEditor, TONE_DOT, TONE_INK, frameNotice, lensLabel, mentionChips, sizeShort } from './shot-parts'

/**
 * The board: one column per scene, scrolled sideways - `docs/ui design/Route -
 * Storyboard v2.dc.html`, "BOARD". A column is 340px, `--s1` on a 16px
 * radius, its border `--line` while selected and `--line2` otherwise; the
 * header is the collapse chevron, the status dot, `Scene NN` over the mono
 * `slug · DN`, and the count pill; the list scrolls inside the column; the
 * foot is `+ New shot`. After the last column, a dashed `+ New scene`.
 *
 * ## A card is a shot, and a click opens it on the canvas
 *
 * The mockup draws no drawer and no buttons on a card - the card is
 * `cursor: grab`. Dragging a card reorders it in its scene (the drop lands
 * it before the card under the pointer, or at the end). Clicking one
 * opens the canvas view on its scene (ruled 2026-09-17; it opened the
 * editor in place until then), where the shot is authored - the inline
 * description, the `Lens` tab, `Generate`, `⋯ → Edit / Remove`. The view
 * is state, not a URL (`view-state.tsx`, ruled the same day), so the card
 * and the column's `Open` are buttons over `view.onOpenCanvas`, not links
 * over `?view=canvas` - the card a `role="button"` block, as the list's
 * scene rows are, because its layers are block content. The board keeps
 * one editor: `+ New shot`. A proposal is a card with an amber dashed
 * border and `proposed` in its tile, so a decision waiting is visible
 * without opening it.
 *
 * ## The card is the frame (2026-09-17)
 *
 * Ruled off the mockup's text card (label, number, size · lens, a 104×59
 * thumbnail and two lines of description, all at once): the card is the
 * frame at the column's width, 16:9, and its text is under the pointer.
 * Three layers - the media, full bleed (the picture, or the dashed `no
 * frame` tile with the job's state and any notice); the number pill and,
 * when the shot says anything, a three-lines mark, always on top; and the
 * detail overlay - description, `@` chips, `WS · 24MM · STATIC` - that the
 * hover fades up while the media blurs and the mark fades out. The hover is
 * CSS (`.folio-shot-card` in `globals.css`), never state: nothing
 * re-renders on a mouseover. The overlay's text is in the DOM at rest, so
 * the walk reads it without hovering.
 *
 * `+ New shot` opens the same editor as a new card at the foot of the list;
 * `+ New scene` links to the script, because a scene is a heading there and
 * nowhere else (AGENTS.md: the script is the only hand-authored artefact).
 *
 * `Auto board` is the empty column's one action, as the mockup draws it; a
 * column that already has shots keeps it as a small foot button beside
 * `New shot`, because the proposer is per scene and re-proposing replaces
 * only what is still waiting.
 */

const DRAG_TYPE = 'application/x-folio-shot'

export const BoardView = ({ view, scriptHref }: { readonly view: ViewProps; readonly scriptHref: EpisodeRoutePath }) => {
  const scroller = useRef<HTMLDivElement>(null)

  // A pick in the sidebar scrolls that column into view.
  useEffect(() => {
    if (view.selected === null || scroller.current === null) return
    const column = scroller.current.querySelector<HTMLElement>(`[data-scene-column="${view.selected}"]`)
    column?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [view.selected])

  return (
    <div ref={scroller} data-board className="folio-board min-h-0 flex-1 overflow-auto px-[20px] pb-[14px]">
      <div className="flex h-full min-w-min items-stretch gap-[14px]" data-scene-columns>
        {view.scenes.map((scene) => (
          <SceneColumn key={scene.sceneNodeId} scene={scene} view={view} />
        ))}
        <Link
          href={scriptHref}
          title="A scene is a heading in the script"
          data-new-scene
          className="folio-new-scene flex w-[200px] flex-none items-center justify-center gap-[8px] rounded-panel border border-dashed border-line text-13 text-ink3 no-underline"
        >
          <span className="text-15 leading-none">+</span>New scene
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A column
// ---------------------------------------------------------------------------

const SceneColumn = ({ scene, view }: { readonly scene: StoryboardScene; readonly view: ViewProps }) => {
  const selected = scene.sceneNodeId === view.selected
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const shown = scene.shots.filter(view.visible)
  const proposals = scene.shots.filter((shot) => shot.state === 'proposed')
  const accepted = scene.shots.length - proposals.length
  const tone = sceneTone(scene)

  const indexOfDrop = (event: DragEvent, fallback: number): number => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    return fallback
  }

  const onDrop = useCallback(
    (event: DragEvent, index: number) => {
      event.preventDefault()
      setDropAt(null)
      const shotId = event.dataTransfer.getData(DRAG_TYPE)
      if (shotId === '' || !scene.shots.some((shot) => shot.id === shotId)) return
      // The index among the scene's shots once the dragged one is lifted out.
      const from = scene.shots.findIndex((shot) => shot.id === shotId)
      const to = from < index ? index - 1 : index
      if (to === from) return
      view.handlers.onPlace(shotId, to)
    },
    [scene.shots, view.handlers],
  )

  return (
    <div
      data-scene-column={scene.sceneNodeId}
      data-scene-number={scene.number}
      data-selected={selected ? 'true' : 'false'}
      data-column-shots={accepted}
      onClick={() => {
        view.onSelect(scene.sceneNodeId)
      }}
      className={`flex w-[340px] flex-none snap-start flex-col overflow-hidden rounded-panel border bg-s1 ${selected ? 'border-line' : 'border-line2'}`}
    >
      <div className="flex flex-none items-center gap-[9px] pb-[10px] pl-[14px] pr-[14px] pt-[14px]">
        <button
          type="button"
          title={collapsed ? 'Show shots' : 'Hide shots'}
          aria-expanded={!collapsed}
          data-collapse-column
          className="folio-ghost-button grid h-[18px] w-[18px] flex-none place-items-center rounded-[6px] opacity-45"
          onClick={(event) => {
            event.stopPropagation()
            setCollapsed((value) => !value)
          }}
        >
          <Icon name="chevron" size={12} strokeWidth={1.5} className={collapsed ? 'folio-folded' : ''} />
        </button>
        <span className={`h-[7px] w-[7px] flex-none rounded-full ${TONE_DOT[tone]}`} />
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="truncate text-14-5 font-medium tracking-title">Scene {sceneNo(scene.number)}</span>
          <span className="truncate font-mono text-10-5 text-ink3">
            {sceneSlug(scene)} · {dayNight(scene.timeOfDay)}
          </span>
        </span>
        <span className="tabular grid h-[22px] min-w-[22px] flex-none place-items-center rounded-pill bg-s2 px-[7px] text-11-5 text-ink2" data-column-count>
          {count(accepted)}
        </span>
        {/* The canvas, on this scene. */}
        <button
          type="button"
          data-open-canvas
          title="Open this scene on the canvas"
          className="folio-pill-button flex h-[26px] flex-none items-center gap-[5px] rounded-[8px] px-[9px] text-11-5"
          onClick={() => {
            view.onOpenCanvas(scene.sceneNodeId)
          }}
        >
          <Icon name="canvas" size={12} strokeWidth={1.5} />
          Open
        </button>
      </div>

      {collapsed ? null : (
        <div
          className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto px-[10px] pb-[6px] pt-[4px]"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
            setDropAt(indexOfDrop(event, scene.shots.length))
          }}
          onDragLeave={() => {
            setDropAt(null)
          }}
          onDrop={(event) => {
            onDrop(event, scene.shots.length)
          }}
        >
          {proposals.length > 0 ? (
            <div className="flex items-center gap-[8px] rounded-[10px] bg-warn-bg px-[10px] py-[6px] text-12" data-proposal-bar>
              <span className="min-w-0 flex-1 text-ink">
                {proposals.length} proposed · accept or edit
              </span>
              <button
                type="button"
                data-accept-all
                disabled={view.pending}
                className="folio-ghost-button rounded-[8px] px-[8px] py-[3px] text-12 font-medium text-ink disabled:opacity-60"
                onClick={(event) => {
                  event.stopPropagation()
                  view.handlers.onAcceptAll(
                    scene.sceneNodeId,
                    proposals.map((shot) => shot.id),
                  )
                }}
              >
                Accept all
              </button>
            </div>
          ) : null}

          {scene.shots.length === 0 ? (
            <NoShots
              pending={view.pending}
              onPropose={() => {
                view.handlers.onPropose(scene.sceneNodeId)
              }}
            />
          ) : shown.length === 0 ? (
            <p className="m-0 px-[4px] py-[12px] text-12-5 text-ink3" data-no-match>
              No shots match this filter.
            </p>
          ) : (
            shown.map((shot) => {
              const index = scene.shots.indexOf(shot)
              return (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  view={view}
                  dropBefore={dropAt === index}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
                    event.stopPropagation()
                    setDropAt(indexOfDrop(event, index))
                  }}
                  onDrop={(event) => {
                    event.stopPropagation()
                    onDrop(event, index)
                  }}
                />
              )
            })
          )}

          {adding ? (
            <div data-add-shot-form className="rounded-card border border-line bg-s1">
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
          ) : null}
          {dropAt === scene.shots.length && scene.shots.length > 0 ? <span aria-hidden className="folio-drop-line" /> : null}
        </div>
      )}

      <div className="flex flex-none items-center gap-[4px] px-[10px] pb-[12px] pt-[6px]">
        <button
          type="button"
          data-add-shot
          disabled={view.pending || adding}
          className="folio-ghost-button flex flex-1 items-center gap-[8px] rounded-[11px] px-[12px] py-[10px] text-13 text-ink3 hover:bg-s2 disabled:opacity-60"
          onClick={(event) => {
            event.stopPropagation()
            view.onSelect(scene.sceneNodeId)
            setCollapsed(false)
            setAdding(true)
          }}
        >
          <span className="text-15 leading-none">+</span>New shot
        </button>
        {scene.shots.length > 0 ? (
          <button
            type="button"
            data-auto-board
            title="Propose a shot list from the scene text. Replaces proposals still waiting."
            disabled={view.pending}
            className="folio-ghost-button flex-none whitespace-nowrap rounded-[11px] px-[12px] py-[10px] text-13 text-ink3 hover:bg-s2 disabled:opacity-60"
            onClick={(event) => {
              event.stopPropagation()
              view.handlers.onPropose(scene.sceneNodeId)
            }}
          >
            Auto board
          </button>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A card
// ---------------------------------------------------------------------------

const ShotCard = ({
  shot,
  view,
  dropBefore,
  onDragOver,
  onDrop,
}: {
  readonly shot: ShotRow
  readonly view: ViewProps
  readonly dropBefore: boolean
  readonly onDragOver: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
}) => {
  const { frame } = shot
  // `Frames` off in Display hides the picture; the tile then says `drawn`.
  const picture = view.display.frames && isDrawn(shot)
  const label = shotStateLabel(shot)
  const tone = shotTone(shot)
  const notice = frameNotice(shot)
  const said = view.display.descriptions && shot.description.length > 0
  const chips = mentionChips(shot.description, view.book)
  return (
    // The canvas, on this shot's scene, as the column's `Open`. A `role="button"` block, not a `<button>`: the layers below are block content.
    <div
      role="button"
      tabIndex={0}
      data-shot={shot.id}
      data-shot-state={shot.state}
      data-shot-number={shot.number}
      draggable={!view.pending}
      aria-label={`Shot ${shot.number} · open on the canvas`}
      className={`folio-shot-card ${dropBefore ? 'folio-drop-before' : ''}`}
      onClick={() => {
        view.onOpenCanvas(shot.sceneNodeId)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          view.onOpenCanvas(shot.sceneNodeId)
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, shot.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="folio-shot-clip">
        {/* Layer 1 - the media. */}
        {picture && (frame.kind === 'drawn' || frame.kind === 'uploaded') ? (
          <span data-frame={frame.kind} className="folio-shot-media folio-frame">
            <span aria-hidden className="folio-frame-grid absolute inset-0" />
            {/* A plain img: the frame is at a URL the worker or the upload wrote, not an asset Next can optimise. */}
            <img src={frame.url} alt={`Frame for shot ${shot.number}`} className="absolute inset-0 h-full w-full object-cover" />
          </span>
        ) : (
          <span data-frame={picture ? frame.kind : label} className="folio-shot-media">
            <span className="absolute inset-[6px] flex flex-col items-center justify-center gap-[6px] rounded-[8px] border border-dashed border-line bg-s1 px-[16px]">
              <span className={`font-mono text-10 tracking-[.06em] ${TONE_INK[tone]}`}>{label}</span>
              {/* Why a frame failed or was refused is never hidden in a hover - it sits under the state. */}
              {notice === null ? null : (
                <span
                  className={`folio-clamp-2 text-center text-11-5 leading-[1.45] ${frame.kind === 'failed' || frame.kind === 'blocked' ? 'text-live' : 'text-ink3'}`}
                  data-frame-notice
                >
                  {notice}
                </span>
              )}
            </span>
          </span>
        )}

        {/* Layer 2 - what is always readable: the number, and that there is text. */}
        <span className="folio-shot-pill">{shot.number}</span>
        {said ? (
          <span className="folio-shot-mark" data-shot-mark title="Has a description">
            <Icon name="list" size={11} strokeWidth={1.7} />
          </span>
        ) : null}

        {/* Layer 3 - the detail, under the pointer. */}
        <div className="folio-shot-over" data-shot-detail>
          {said ? (
            <p className="folio-clamp-3 m-0 text-12-5 leading-[1.5] text-shot-over-ink" data-shot-description>
              <Description content={shot.description} book={view.book} />
            </p>
          ) : null}
          {chips.length > 0 ? (
            <span className="flex flex-wrap gap-[6px]" data-shot-chips>
              {chips.map((chip) => (
                <span key={chip} className="folio-shot-chip">
                  {chip}
                </span>
              ))}
            </span>
          ) : null}
          <span className="folio-shot-camera" data-shot-camera>
            {sizeShort(shot)} · {lensLabel(shot.lensMm)} · {SHOT_MOVEMENT_LABEL[shot.movement]}
          </span>
        </div>
      </div>
    </div>
  )
}
