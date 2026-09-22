'use client'

import type { ProductionScene, ReelStatus } from '@folio/contracts'

import { useProduction } from './production-context'

/**
 * §2.6, the reel strip: one chip per reel of the selected scene - the name,
 * a `Start Shooting` button, a status dot, `＋` - and a trailing dashed `＋`
 * tile. The selected chip sits on `--s2` with the accent border and ring.
 * Clicking the name or the button selects the reel (the mockup's `pick`;
 * the readiness bar below is where the shoot itself happens).
 */
const DOT: Readonly<Record<ReelStatus, string>> = {
  rendered: 'ok',
  generating: 'accent',
  stale: 'warn',
  writing: 'ink3',
}

export const ReelStrip = ({ scene }: { readonly scene: ProductionScene }) => {
  const { selection, act } = useProduction()
  return (
    <div className="folio-prod-strip" data-reel-strip>
      {scene.reels.map((reel) => {
        const on = selection?.reelId === reel.id
        return (
          <span key={reel.id} className="folio-prod-reel-chip" data-reel-chip={reel.id} data-selected={on ? 'true' : undefined}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => {
                act.selectReel(scene.sceneNodeId, reel.id)
              }}
              className="folio-prod-reel-name"
            >
              {reel.name}
            </button>
            <button
              type="button"
              title={`${scene.heading} · ${reel.name}`}
              onClick={() => {
                act.selectReel(scene.sceneNodeId, reel.id)
              }}
              className="folio-prod-reel-shoot"
            >
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                <path d="M12.6 3.4l4 4L7.4 16.6l-4.4 1 1-4.4z" />
              </svg>
              Start Shooting
            </button>
            <span className="folio-prod-dot" data-tone={DOT[reel.status]} aria-label={`Reel status: ${reel.status}`} role="img" />
            <button
              type="button"
              title="New reel"
              aria-label="New reel"
              onClick={() => {
                act.addReel(scene.sceneNodeId)
              }}
              className="folio-prod-x"
            >
              ＋
            </button>
          </span>
        )
      })}
      <button
        type="button"
        title="New reel"
        aria-label="New reel"
        data-new-reel
        onClick={() => {
          act.addReel(scene.sceneNodeId)
        }}
        className="folio-prod-reel-add"
      >
        ＋
      </button>
    </div>
  )
}
