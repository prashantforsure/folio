'use client'

import type { ShotRow, StoryboardScene } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import type { DragEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { dayNight, sceneNo, sceneSlug, sceneTone } from '../../../../../../lib/storyboard/board'
import { count } from '../../../../../../lib/workspace/format'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { ViewProps } from './handlers'
import { BLANK_SHOT, Description, FrameTile, NoShots, ShotEditor, TONE_DOT, editorActionsFor, frameNotice, lensLabel, sizeShort } from './shot-parts'

/**
 * The board: one column per scene, scrolled sideways - `docs/ui design/Route -
 * Storyboard v2.dc.html`, "BOARD". A column is 340px, `--s1` on a 16px
 * radius, its border `--line` while selected and `--line2` otherwise; the
 * header is the collapse chevron, the status dot, `Scene NN` over the mono
 * `slug · DN`, and the count pill; the list scrolls inside the column; the
 * foot is `+ New shot`. After the last column, a dashed `+ New scene`.
 *
 * ## A card is a shot, and a shot is edited where it is
 *
 * The mockup draws no drawer and no buttons on a card - the card is
 * `cursor: grab`. So: dragging a card reorders it in its scene (the drop
 * lands it before the card under the pointer, or at the end); clicking one
 * turns it into the editor in place, whose footer holds every other action
 * (Remove / Discard on the left; Draw frame · N cr, Cancel frame or Accept
 * beside Save). A proposal is a card with an amber dashed tile and its
 * state in the eyebrow, so a decision waiting is visible without opening it.
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
  const [editing, setEditing] = useState<string | null>(null)
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
              return editing === shot.id ? (
                <div key={shot.id} data-shot={shot.id} data-shot-state={shot.state} className="rounded-card border border-line bg-s1">
                  <ShotEditor
                    shot={shot}
                    title={`Shot ${shot.number}`}
                    labels={view.labels}
                    book={view.book}
                    pending={view.pending}
                    {...editorActionsFor(shot, view)}
                    onCancel={() => {
                      setEditing(null)
                    }}
                    onSave={(edit) => {
                      view.handlers.onSave(shot.id, edit)
                      setEditing(null)
                    }}
                  />
                </div>
              ) : (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  heading={scene.heading}
                  view={view}
                  dropBefore={dropAt === index}
                  onOpen={() => {
                    setEditing(shot.id)
                  }}
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
  heading,
  view,
  dropBefore,
  onOpen,
  onDragOver,
  onDrop,
}: {
  readonly shot: ShotRow
  readonly heading: string
  readonly view: ViewProps
  readonly dropBefore: boolean
  readonly onOpen: () => void
  readonly onDragOver: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
}) => {
  const proposed = shot.state === 'proposed'
  const notice = frameNotice(shot)
  return (
    <div
      role="button"
      tabIndex={0}
      data-shot={shot.id}
      data-shot-state={shot.state}
      data-shot-number={shot.number}
      draggable={!view.pending}
      aria-label={`Shot ${shot.number}`}
      className={`folio-shot-card relative flex flex-col gap-[9px] rounded-card border p-[12px] ${proposed ? 'border-dashed border-warn' : 'border-line2'} bg-s1 ${dropBefore ? 'folio-drop-before' : ''}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, shot.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex gap-[11px]">
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-10-5 font-medium uppercase tracking-[.09em] text-ink3">
            {proposed ? 'Proposed · ' : ''}
            {heading === '' ? 'No heading yet' : heading}
          </span>
          <span className="text-14 font-medium text-ink">{shot.number}</span>
          <span className="font-mono text-10-5 text-ink3">
            {sizeShort(shot)} · {lensLabel(shot.lensMm)}
          </span>
        </span>
        {view.display.frames ? <FrameTile shot={shot} size="card" /> : null}
      </div>
      {view.display.descriptions && shot.description.length > 0 ? (
        <p className="folio-clamp-2 m-0 text-13 leading-[1.5] text-ink2" data-shot-description>
          <Description content={shot.description} book={view.book} />
        </p>
      ) : null}
      {notice === null ? null : (
        <p className={`m-0 text-11-5 leading-[1.45] ${shot.frame.kind === 'failed' || shot.frame.kind === 'blocked' ? 'text-live' : 'text-ink3'}`} data-frame-notice>
          {notice}
        </p>
      )}
    </div>
  )
}

