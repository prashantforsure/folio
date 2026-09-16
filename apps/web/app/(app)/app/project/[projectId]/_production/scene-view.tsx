'use client'

import type { CastRow, ProductionScene, ProjectId } from '@folio/contracts'
import { memo } from 'react'

import type { LocationSummary } from '../../../../../../lib/production/server'
import type { SceneCoverage } from '../../../../../../lib/production/view'
import { orphanLabel, sceneStatus, sceneTabLabel } from '../../../../../../lib/production/view'
import type { SceneViewProps } from './handlers'
import { Mark } from './mark'
import { ReelSection } from './reel-section'

/**
 * The Scene view - `Route - Production v2.dc.html`, `data-screen-label="Scene"`:
 * the scene strip (one tab per scene with its status dot, the selected one
 * lit, `＋ Add reel` at the end), then the scrolling column at 1180px -
 * the orphan strip when the Storyboard has shots not yet in a reel, the
 * empty card when the scene has no reel, and one card per reel.
 *
 * Which scene is selected is component state, never the URL (open
 * decision 10); the sidebar's rows and the strip's tabs pick the same one.
 */

export const EmptyScene = ({ sceneNodeId, frameCost, view }: { readonly sceneNodeId: string; readonly frameCost: number; readonly view: SceneViewProps }) => (
  <div
    className="flex flex-col items-center gap-[14px] rounded-[16px] border border-dashed border-line bg-s1 px-[24px] py-[56px] text-center"
    data-empty-scene
  >
    <span className="text-15 font-medium tracking-title">No reels in this scene yet</span>
    <div className="flex flex-wrap items-center justify-center gap-[8px]">
      <button
        type="button"
        data-propose-scene
        disabled={view.pending}
        className="folio-accent-button h-[34px] rounded-[9px] px-[15px] text-13"
        onClick={() => {
          view.handlers.onProposeForScene(sceneNodeId)
        }}
      >
        <Mark glyph="✦" /> Propose shots from scene
      </button>
      <button
        type="button"
        data-add-reel-empty
        disabled={view.pending}
        className="folio-line-button h-[34px] rounded-[9px] px-[15px] text-13"
        data-line="strong"
        onClick={() => {
          view.handlers.onAddReel(sceneNodeId)
        }}
      >
        ＋ Empty reel
      </button>
    </div>
    <span className="text-12 text-ink3">Proposing shots costs nothing. Frames cost {frameCost} credits each.</span>
  </div>
)

export const SceneView = memo(
  ({
    projectId,
    scenes,
    coverage,
    selected,
    onSelect,
    castById,
    locations,
    view,
  }: {
    readonly projectId: ProjectId
    readonly scenes: readonly ProductionScene[]
    readonly coverage: readonly SceneCoverage[]
    readonly selected: string | null
    readonly onSelect: (sceneNodeId: string) => void
    readonly castById: ReadonlyMap<string, CastRow>
    readonly locations: ReadonlyMap<string, LocationSummary>
    readonly view: SceneViewProps
  }) => {
    const scene = scenes.find((entry) => entry.sceneNodeId === selected) ?? null
    const row = coverage.find((entry) => entry.sceneNodeId === selected) ?? null
    const cast = scene === null ? [] : scene.cast.map((id) => castById.get(id)).filter((entry): entry is CastRow => entry !== undefined)
    const location = scene === null || scene.locationId === null ? null : (locations.get(scene.locationId) ?? null)
    const firstReel = scene?.reels[0] ?? null

    return (
      <div data-screen="scene" className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-[8px] px-[20px] pb-[12px]">
          <div className="flex min-w-0 flex-1 items-center gap-[4px] overflow-x-auto pb-[2px]" data-scene-strip>
            {coverage.map((entry) => {
              const status = sceneStatus(entry.mode)
              return (
                <button
                  key={entry.sceneNodeId}
                  type="button"
                  className="folio-scene-tab"
                  aria-current={entry.sceneNodeId === selected ? 'true' : undefined}
                  data-scene-tab={entry.sceneNodeId}
                  data-scene-mode={entry.mode}
                  onClick={() => {
                    onSelect(entry.sceneNodeId)
                  }}
                >
                  <span className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full" data-tone={status.tone} />
                  <span className="whitespace-nowrap font-mono text-11-5 uppercase">{sceneTabLabel(entry)}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            data-add-reel
            disabled={view.pending || scene === null}
            className="folio-accent-button h-[32px] flex-none px-[13px]"
            onClick={() => {
              if (scene !== null) view.handlers.onAddReel(scene.sceneNodeId)
            }}
          >
            ＋ Add reel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-[14px]">
            {scene === null || row === null ? (
              <span className="text-12-5 text-ink3">Pick a scene.</span>
            ) : (
              <>
                {row.unreeled > 0 ? (
                  <div className="flex items-center gap-[12px] rounded-[11px] border border-line2 bg-s1 px-[14px] py-[10px]" data-orphan-strip>
                    <span className="min-w-0 flex-1 text-12-5 text-ink2">{orphanLabel(row.unreeled)}</span>
                    <button
                      type="button"
                      data-put-orphans
                      disabled={view.pending}
                      className="folio-line-button h-[28px] flex-none rounded-[8px] px-[12px] text-12"
                      data-line="strong"
                      onClick={() => {
                        view.handlers.onPutOrphans(scene.sceneNodeId, firstReel?.id ?? null)
                      }}
                    >
                      {firstReel === null ? 'Put them in a new reel' : `Put them in ${firstReel.name}`}
                    </button>
                  </div>
                ) : null}

                {scene.reels.length === 0 ? <EmptyScene sceneNodeId={scene.sceneNodeId} frameCost={view.input.frameCost} view={view} /> : null}

                {scene.reels.map((reel, index) => (
                  <ReelSection
                    key={reel.id}
                    projectId={projectId}
                    scene={scene}
                    reel={reel}
                    first={index === 0}
                    last={index === scene.reels.length - 1}
                    cast={cast}
                    location={location}
                    view={view}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    )
  },
)
SceneView.displayName = 'SceneView'
