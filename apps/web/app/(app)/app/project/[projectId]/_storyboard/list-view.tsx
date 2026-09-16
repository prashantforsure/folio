'use client'

import type { StoryboardScene } from '@folio/contracts'
import { CAMERA_ANGLE_LABEL, SHOT_MOVEMENT_LABEL } from '@folio/script'
import { Icon } from '@folio/ui'
import { useState } from 'react'

import { SHOT_SORT_LABEL, groupLabel, sceneTone, sortShots } from '../../../../../../lib/storyboard/board'
import { count } from '../../../../../../lib/workspace/format'
import type { ViewProps } from './handlers'
import { Description, FrameTile, TONE_DOT, durationLabel, lensLabel, sizeName } from './shot-parts'

/**
 * The shot list: one table, grouped by scene - `docs/ui design/Route -
 * Storyboard v2.dc.html`, "LIST". A `--s1` card at least 1020px wide with
 * a 14px radius; a sticky eyebrow header row on `--sunk` (Board · Shot ·
 * Shot size · Camera · Movement · Lens · Dur. · Description, at the
 * mockup's column widths); a group row per scene - chevron, dot, the mono
 * `01 — EXT. COMMUNITY PITCH`, the count; and a row per shot with its
 * 120×68 frame. A scene with no shots prints "No shots listed for this
 * scene."
 *
 * Rows are read-only, as the mockup draws them; clicking a group row
 * selects the scene so the canvas and the sidebar follow, and the chevron
 * folds the group. The order within a group is the `Display` menu's sort
 * (2026-09-17, `sortShots`): story order by default, else shot size, lens
 * or needs-work-first, each stable over the sequence. The header says
 * when it is not the sequence, so the print is never mistaken for the
 * board's order.
 */
export const ListView = ({ view }: { readonly view: ViewProps }) => (
  <div data-shot-list className="min-h-0 flex-1 overflow-auto px-[20px] pb-[20px]">
    <div className="min-w-[1020px] overflow-hidden rounded-[14px] border border-line2 bg-s1">
      <div className="folio-eyebrow sticky top-0 z-[4] flex items-center gap-[12px] border-b border-line2 bg-sunk px-[16px] py-[11px]">
        <span className="w-[120px] flex-none">Board</span>
        <span className="w-[66px] flex-none">Shot</span>
        <span className="w-[124px] flex-none">Shot size</span>
        <span className="w-[84px] flex-none">Camera</span>
        <span className="w-[90px] flex-none">Movement</span>
        <span className="w-[60px] flex-none">Lens</span>
        <span className="w-[56px] flex-none">Dur.</span>
        <span className="min-w-0 flex-1">Description</span>
        {view.sort === 'sequence' ? null : (
          <span className="flex-none normal-case tracking-normal text-ink3" data-sorted-by>
            sorted by {SHOT_SORT_LABEL[view.sort].toLowerCase()}
          </span>
        )}
      </div>

      {view.scenes.map((scene) => (
        <SceneGroup key={scene.sceneNodeId} scene={scene} view={view} />
      ))}
    </div>
  </div>
)

const SceneGroup = ({ scene, view }: { readonly scene: StoryboardScene; readonly view: ViewProps }) => {
  const [folded, setFolded] = useState(false)
  const shown = sortShots(scene.shots.filter(view.visible), view.sort)
  const accepted = scene.shots.filter((shot) => shot.state === 'accepted').length
  return (
    <div data-list-scene={scene.sceneNodeId} data-selected={scene.sceneNodeId === view.selected ? 'true' : 'false'}>
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer items-center gap-[9px] border-b border-line2 bg-s1 px-[16px] py-[10px]"
        onClick={() => {
          view.onSelect(scene.sceneNodeId)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            view.onSelect(scene.sceneNodeId)
          }
        }}
      >
        <button
          type="button"
          title={folded ? 'Show shots' : 'Hide shots'}
          aria-expanded={!folded}
          className="folio-ghost-button grid h-[16px] w-[16px] flex-none place-items-center rounded-[5px] opacity-45"
          onClick={(event) => {
            event.stopPropagation()
            setFolded((value) => !value)
          }}
        >
          <Icon name="chevron" size={11} strokeWidth={1.5} className={folded ? 'folio-folded' : ''} />
        </button>
        <span className={`h-[6px] w-[6px] flex-none rounded-full ${TONE_DOT[sceneTone(scene)]}`} />
        <span className="whitespace-nowrap font-mono text-11-5 uppercase text-ink">{groupLabel(scene.number, scene.heading)}</span>
        <span className="text-12 text-ink3">{count(accepted)}</span>
      </div>

      {folded ? null : scene.shots.length === 0 ? (
        <div className="border-b border-line2 px-[16px] py-[14px]">
          <span className="text-12-5 text-ink3">No shots listed for this scene.</span>
        </div>
      ) : shown.length === 0 ? (
        <div className="border-b border-line2 px-[16px] py-[14px]">
          <span className="text-12-5 text-ink3">No shots match this filter.</span>
        </div>
      ) : (
        shown.map((shot) => (
          <div
            key={shot.id}
            data-list-shot={shot.id}
            data-shot-state={shot.state}
            className="flex items-center gap-[12px] border-b border-line2 px-[16px] py-[10px] hover:bg-s1"
          >
            {view.display.frames ? <FrameTile shot={shot} size="row" /> : <span className="w-[120px] flex-none" />}
            <span className="w-[66px] flex-none font-mono text-12 text-ink">{shot.number}</span>
            <span className="w-[124px] flex-none text-13 font-medium">
              {sizeName(shot)}
              {shot.state === 'proposed' ? <span className="ml-[6px] font-mono text-10 font-normal text-warn">proposed</span> : null}
            </span>
            <span className="w-[84px] flex-none text-13 text-ink2">{CAMERA_ANGLE_LABEL[shot.angle]}</span>
            <span className="w-[90px] flex-none text-13 text-ink2">{SHOT_MOVEMENT_LABEL[shot.movement]}</span>
            <span className="w-[60px] flex-none font-mono text-12 text-ink2">{lensLabel(shot.lensMm)}</span>
            <span className="w-[56px] flex-none font-mono text-12 text-ink3">{durationLabel(shot.durationSeconds)}</span>
            <span className="min-w-0 flex-1 text-13 leading-[1.5] text-ink2">
              {view.display.descriptions ? <Description content={shot.description} book={view.book} /> : null}
            </span>
          </div>
        ))
      )}
    </div>
  )
}
