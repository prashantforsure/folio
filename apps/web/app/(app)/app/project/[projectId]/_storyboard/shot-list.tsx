'use client'

import type { StoryboardScene } from '@folio/contracts'
import type { LabelBook } from '@folio/script'
import { CAMERA_ANGLE_LABEL, SHOT_MOVEMENT_LABEL } from '@folio/script'

import { Description, durationLabel, lensLabel, sizeName } from './shot-parts'

/**
 * The shot list: one table, grouped by scene. `Route - Storyboard.dc.html`,
 * "SHOT LIST": a sticky 9.5px uppercase header row (Board · Shot · Shot
 * size · Camera · Movement · Lens · Dur. · Description), a Courier Prime
 * group row per scene with its count, and a row per shot with a 150px
 * thumbnail. A scene with no shots prints "No shots listed for this scene."
 *
 * The bundle's subheader says "sortable columns"; the columns are not
 * sortable here. A shot list's order is the shot order, and a sort that
 * reorders the print is a different document from the board. Flagged.
 */
export const ShotList = ({ scenes, book }: { readonly scenes: readonly StoryboardScene[]; readonly book: LabelBook }) => (
  <div data-shot-list className="min-h-0 flex-1 overflow-auto">
    <div className="min-w-[940px]">
      <div className="sticky top-0 z-[5] flex items-center gap-[12px] border-b border-line bg-panel px-[16px] py-[9px] text-9-5 font-semibold uppercase tracking-[.08em] text-ink3">
        <span className="w-[150px] flex-none">Board</span>
        <span className="w-[58px] flex-none">Shot</span>
        <span className="w-[118px] flex-none">Shot size</span>
        <span className="w-[74px] flex-none">Camera</span>
        <span className="w-[84px] flex-none">Movement</span>
        <span className="w-[56px] flex-none">Lens</span>
        <span className="w-[56px] flex-none">Dur.</span>
        <span className="min-w-0 flex-1">Description</span>
      </div>

      {scenes.map((scene) => (
        <div key={scene.sceneNodeId} data-list-scene={scene.sceneNodeId}>
          <div className="flex items-center gap-[8px] border-b border-line2 bg-panel px-[16px] py-[8px]">
            <span className="text-9 text-ink3">▾</span>
            <span className="font-mono text-11-5 uppercase">
              {String(scene.number).padStart(2, '0')} — {scene.heading === '' ? 'untitled' : scene.heading}
            </span>
            <span className="text-10-5 text-ink3">({scene.shots.length})</span>
          </div>
          {scene.shots.length === 0 ? (
            <div className="border-b border-line2 p-[16px]">
              <span className="text-11 text-ink3">No shots listed for this scene.</span>
            </div>
          ) : (
            scene.shots.map((shot) => {
              const drawn = shot.frame.kind === 'drawn'
              return (
                <div
                  key={shot.id}
                  data-list-shot={shot.id}
                  data-shot-state={shot.state}
                  className="flex items-center gap-[12px] border-b border-line2 px-[16px] py-[11px] hover:bg-hover"
                >
                  <div
                    className={`grid aspect-video w-[150px] flex-none place-items-center overflow-hidden rounded-chrome border ${
                      drawn ? 'border-line' : shot.state === 'proposed' ? 'border-note bg-note-bg' : 'border-line2 bg-hover'
                    }`}
                    style={drawn ? { background: 'linear-gradient(160deg, var(--frame-a), var(--frame-b))' } : undefined}
                  >
                    {drawn && shot.frame.kind === 'drawn' ? (
                      <img src={shot.frame.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className={`font-mono text-8 ${shot.state === 'proposed' ? 'text-note' : 'text-ink3'}`}>
                        {shot.state === 'proposed' ? 'proposed' : shot.frame.kind === 'empty' ? 'no frame' : shot.frame.kind}
                      </span>
                    )}
                  </div>
                  <span className="w-[58px] flex-none font-mono text-11">{shot.number}</span>
                  <span className="w-[118px] flex-none text-11-5 font-medium">{sizeName(shot)}</span>
                  <span className="w-[74px] flex-none text-11-5 text-ink2">{CAMERA_ANGLE_LABEL[shot.angle]}</span>
                  <span className="w-[84px] flex-none text-11-5 text-ink2">{SHOT_MOVEMENT_LABEL[shot.movement]}</span>
                  <span className="w-[56px] flex-none font-mono text-11 text-ink2">{lensLabel(shot.lensMm)}</span>
                  <span className="w-[56px] flex-none font-mono text-11 text-ink3">{durationLabel(shot.durationSeconds)}</span>
                  <span className="min-w-0 flex-1 text-11-5 leading-[1.45] text-ink2">
                    <Description content={shot.description} book={book} />
                  </span>
                </div>
              )
            })
          )}
        </div>
      ))}
    </div>
  </div>
)
