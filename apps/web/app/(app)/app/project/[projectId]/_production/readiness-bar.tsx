'use client'

import type { ProductionScene, Reel } from '@folio/contracts'
import { GENERATION_COSTS, NOT_READY_TITLE } from '@folio/contracts'

import { hasClip, missingAppearances, readinessOf, reelTiming } from '../../../../../../lib/production/derive'
import { useProduction } from './production-context'

/**
 * §3.7, the readiness bar: four numbered steps that turn into `✓` when
 * satisfied, each with a label and a mono sub-label; step 4's avatar
 * circles per cast member (dashed warn border = no appearance reference);
 * and `▶ Start shooting · 375 cr` (or `▶ Reshoot reel`), enabled only when
 * all four pass, else `not-allowed` at .55 with the spec's tooltip.
 */
export const ReadinessBar = ({ scene, reel }: { readonly scene: ProductionScene; readonly reel: Reel }) => {
  const { act, model, storage, live } = useProduction()
  const readiness = readinessOf(scene, reel)
  const timing = reelTiming(reel)
  const missing = missingAppearances(scene)
  const shooting = live.find((candidate) => candidate.job === 'shoot_reel' && candidate.targetId === reel.id) ?? null
  const sheetState = reel.sheet?.state ?? 'none'
  const steps = [
    { id: 'shotlist', ok: readiness.shotlist, label: 'Shotlist', sub: `${String(reel.shots.length)} shots · ${String(timing.used)}/${String(timing.target)}s` },
    { id: 'sheet', ok: readiness.sheet, label: 'Storyboard sheet', sub: readiness.sheet ? '1 sheet · all shots' : sheetState === 'gen' ? 'drawing…' : 'not generated' },
    { id: 'scene_image', ok: readiness.sceneImage, label: 'Scene image', sub: `${scene.locationName ?? scene.set} · ${readiness.sceneImage ? 'locked' : 'needed'}` },
    { id: 'characters', ok: readiness.characters, label: 'Characters', sub: missing.length > 0 ? `${missing.map((member) => member.name).join(', ')} missing` : 'from Characters' },
  ] as const
  const connected = model && storage
  const enabled = readiness.canShoot && connected && shooting === null
  const title = !readiness.canShoot ? NOT_READY_TITLE : !model ? 'The model is not connected' : !storage ? 'Storage is not set up on this server yet' : shooting !== null ? 'The reel is shooting' : `${hasClip(reel) ? 'Reshoot' : 'Shoot'} this reel · ${String(GENERATION_COSTS.shoot_reel)} cr`
  const label = shooting !== null ? `◌ Shooting… ${String(shooting.progress ?? 0)}%` : `▶ ${hasClip(reel) ? 'Reshoot reel' : 'Start shooting'} · ${String(GENERATION_COSTS.shoot_reel)} cr`

  return (
    <div className="folio-prod-ready" data-readiness data-can-shoot={readiness.canShoot ? 'true' : 'false'}>
      {steps.map((step, index) => (
        <span key={step.id} className="flex min-w-0 items-center gap-[9px]" data-readiness-step={step.id} data-ok={step.ok ? 'true' : 'false'}>
          <span className="folio-prod-step" data-ok={step.ok ? 'true' : undefined} aria-hidden="true">
            {step.ok ? '✓' : String(index + 1)}
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="whitespace-nowrap text-12" data-ok={step.ok ? 'true' : undefined}>
              {step.label}
              <span className="sr-only">{step.ok ? ' - done' : ' - not yet'}</span>
            </span>
            <span className="whitespace-nowrap font-mono text-10-5 text-ink3">{step.sub}</span>
          </span>
          {step.id === 'characters'
            ? scene.cast.map((member) => (
                <span
                  key={member.id}
                  role="img"
                  title={member.appearanceReady ? `${member.name} — appearance from Characters` : `${member.name} — no appearance yet`}
                  aria-label={member.appearanceReady ? `${member.name}, appearance from Characters` : `${member.name}, no appearance yet`}
                  className="folio-prod-avatar"
                  data-ready={member.appearanceReady ? 'true' : 'false'}
                  style={member.appearanceReady ? { '--cast-h': String(member.hue), backgroundImage: member.portraitUrl === null ? undefined : `url(${member.portraitUrl})` } as React.CSSProperties : undefined}
                >
                  {member.appearanceReady && member.portraitUrl !== null ? null : member.initials}
                </span>
              ))
            : null}
        </span>
      ))}
      <span className="flex-1" />
      {shooting !== null ? (
        <button
          type="button"
          data-cancel-shoot
          onClick={() => {
            act.cancelGeneration(shooting.id)
          }}
          className="folio-prod-line-small h-[34px]"
        >
          Stop
        </button>
      ) : null}
      <button
        type="button"
        data-shoot
        aria-disabled={!enabled}
        title={title}
        onClick={() => {
          if (!enabled) return
          act.shoot(reel.id)
        }}
        className="folio-prod-shoot"
      >
        {label}
      </button>
    </div>
  )
}
