'use client'

import type { ProductionScene } from '@folio/contracts'

import { useProduction } from './production-context'
import { ReelCard } from './reel-card'

/**
 * §3, the Cards view for the selected scene: the empty-scene card when it
 * has no reels (`No reels in this scene yet.` · `✦ Propose shots from the
 * scene` · `＋ Empty reel`), else the selected reel's card.
 */
export const SceneBoard = ({ scene }: { readonly scene: ProductionScene }) => {
  const { selection, act } = useProduction()
  const reel = scene.reels.find((candidate) => candidate.id === selection?.reelId) ?? scene.reels[0] ?? null
  return (
    <section className="flex flex-col gap-[18px] px-[16px] pb-[22px]" data-scene-board={scene.number}>
      {scene.reels.length === 0 ? (
        <div className="folio-prod-empty-scene" data-scene-empty>
          <span className="text-12-5 text-ink3">No reels in this scene yet.</span>
          <span className="flex-1" />
          <button
            type="button"
            data-propose-shots
            onClick={() => {
              act.proposeShots(scene.sceneNodeId)
            }}
            className="folio-prod-accent-small"
          >
            ✦ Propose shots from the scene
          </button>
          <button
            type="button"
            data-empty-reel
            onClick={() => {
              act.addReel(scene.sceneNodeId)
            }}
            className="folio-prod-line-small"
          >
            ＋ Empty reel
          </button>
        </div>
      ) : null}
      {reel === null ? null : <ReelCard scene={scene} reel={reel} />}
    </section>
  )
}
