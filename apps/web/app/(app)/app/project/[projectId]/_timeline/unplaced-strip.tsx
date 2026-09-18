'use client'

import type { TimelineSceneRow } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { useState } from 'react'
import type { DragEvent } from 'react'

import { plural } from '../../../../../../lib/timeline/view'
import type { DropTarget } from './lanes-grid'
import { draggedScene } from './lanes-grid'
import { SCENE_DRAG_TYPE, SceneCard } from './scene-card'

/**
 * Two places the unplaced scenes show while any exist.
 *
 * `UnplacedBanner` sits over the grid in both views (`folio-banner`, the
 * README's amber banner): `7 scenes aren't placed in time yet · Place
 * them · ✕`. `Place them` opens the proposal queue. Dismissed, it stays
 * gone for the visit.
 *
 * `UnplacedStrip` sits under the chronology, where an unplaced scene has
 * no column to be in: a dashed box of the unplaced scenes' cards, so one
 * can be opened and given a day - or dragged up onto a day column -
 * without leaving the view. It is a drop target the other way too: a
 * placed card dropped here loses its time. Story order needs no strip -
 * an unplaced scene is in its episode's column there, with a dashed `no
 * time` chip.
 */
export const UnplacedBanner = ({ count, onPlace, onDismiss }: { readonly count: number; readonly onPlace: () => void; readonly onDismiss: () => void }) => (
  <div role="status" data-unplaced-banner className="folio-banner" data-tone="warn">
    <span aria-hidden="true" className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
    <span className="min-w-0 flex-1 truncate">
      {plural(count, 'scene', 'scenes')} {count === 1 ? "isn't" : "aren't"} placed in time yet
    </span>
    <button type="button" data-banner-place onClick={onPlace} className="folio-line-button h-[26px] flex-none rounded-[7px] px-[9px] text-11-5">
      Place them
    </button>
    <button type="button" title="Dismiss" aria-label="Dismiss" data-banner-dismiss onClick={onDismiss} className="folio-ghost-button grid h-[24px] w-[24px] flex-none place-items-center rounded-[6px] text-12 text-ink3">
      ✕
    </button>
  </div>
)

const UNPLACE: DropTarget = { day: null, rowKey: null, unplace: true }

export const UnplacedStrip = ({
  scenes,
  selected,
  matches,
  onOpen,
  onDrop,
}: {
  readonly scenes: readonly TimelineSceneRow[]
  readonly selected: NodeId | null
  readonly matches: (scene: TimelineSceneRow) => boolean
  readonly onOpen: (id: NodeId) => void
  readonly onDrop: (id: NodeId, target: DropTarget) => void
}) => {
  const [over, setOver] = useState(false)
  const shown = scenes.filter(matches)
  const dragOver = (event: DragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types.includes(SCENE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!over) setOver(true)
  }
  const drop = (event: DragEvent<HTMLElement>): void => {
    const id = draggedScene(event)
    setOver(false)
    if (id === null) return
    event.preventDefault()
    onDrop(id, UNPLACE)
  }
  return (
    <section
      aria-label="Unplaced scenes"
      data-unplaced-strip
      data-drop-target={over ? 'over' : undefined}
      onDragOver={dragOver}
      onDragLeave={() => {
        setOver(false)
      }}
      onDrop={drop}
      className="folio-lane-strip mx-[20px] mb-[24px] flex flex-col gap-[8px] rounded-[12px] border border-dashed border-line px-[12px] py-[10px]"
    >
      <span className="folio-eyebrow">Unplaced · {shown.length}</span>
      {shown.length === 0 ? (
        <span className="text-12 text-ink3">{scenes.length === 0 ? 'Every scene has a time. Drop a card here to take its time away.' : 'No unplaced scene matches the find.'}</span>
      ) : (
        <div className="grid gap-[8px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))' }}>
          {shown.map((scene) => (
            <SceneCard
              key={scene.sceneNodeId}
              scene={scene}
              view="story"
              colour={null}
              selected={scene.sceneNodeId === selected}
              mark={null}
              jump={null}
              also={[]}
              onOpen={() => {
                onOpen(scene.sceneNodeId)
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
