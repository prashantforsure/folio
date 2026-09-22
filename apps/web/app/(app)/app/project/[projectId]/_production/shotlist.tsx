'use client'

import type { Reel } from '@folio/contracts'
import { useState } from 'react'

import { visibleShots } from '../../../../../../lib/production/filters'
import { useProduction } from './production-context'
import { ShotCard } from './shot-card'

/**
 * §3.3, the shotlist column (`flex: 1 1 430px`): the header (`SHOTLIST` ·
 * count · `✦ AI Shotlist` · `＋ Shot`), a card per shot that passes the
 * filter in the chosen sort, and the `＋ Add shot` footer. The cards are
 * drop targets for a drag within or across reels; a drop on the footer
 * lands the shot last.
 */
export const Shotlist = ({ reel }: { readonly reel: Reel }) => {
  const { prefs, act, dragging, live, model } = useProduction()
  const [over, setOver] = useState<string | null>(null)
  const shots = visibleShots(reel.shots, prefs)
  const listing = live.some((generation) => generation.job === 'ai_shotlist' && generation.targetId === reel.id)
  return (
    <div className="flex min-w-0 flex-[1_1_430px] flex-col gap-[9px]" data-shotlist>
      <div className="flex items-center gap-[9px] px-[4px]">
        <span className="folio-prod-eyebrow">Shotlist</span>
        <span className="font-mono text-11 text-ink3" data-shot-count>
          {String(reel.shots.length)} shots
        </span>
        <span className="flex-1" />
        <button
          type="button"
          data-ai-shotlist
          disabled={listing}
          title={model ? 'Propose a shotlist from the scene' : 'The model is not connected - the shotlist is proposed from the scene’s lines instead'}
          onClick={() => {
            act.aiShotlist(reel.id)
          }}
          className="folio-prod-ai-button"
        >
          {listing ? '◌ Writing shotlist…' : '✦ AI Shotlist'}
        </button>
        <button
          type="button"
          data-add-shot
          onClick={() => {
            act.addShot(reel.id)
          }}
          className="folio-prod-line-small h-[26px]"
        >
          ＋ Shot
        </button>
      </div>
      {shots.length === 0 && reel.shots.length > 0 ? (
        <div className="folio-prod-empty-scene" data-no-match>
          <span className="text-12-5 text-ink3">No shots match the current filter.</span>
        </div>
      ) : null}
      {shots.map((shot) => (
        <ShotCard
          key={shot.id}
          reel={reel}
          shot={shot}
          over={over === shot.id}
          onDragOver={(event) => {
            event.preventDefault()
            if (dragging !== null && dragging !== shot.id) setOver(shot.id)
          }}
          onDragLeave={() => {
            setOver((current) => (current === shot.id ? null : current))
          }}
          onDrop={(event) => {
            event.preventDefault()
            setOver(null)
            if (dragging !== null && dragging !== shot.id) act.moveShot(dragging, reel.id, shot.id)
            act.setDragging(null)
          }}
        />
      ))}
      <button
        type="button"
        data-add-shot-footer
        data-over={over === 'end' ? 'true' : undefined}
        onClick={() => {
          act.addShot(reel.id)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (dragging !== null) setOver('end')
        }}
        onDragLeave={() => {
          setOver((current) => (current === 'end' ? null : current))
        }}
        onDrop={(event) => {
          event.preventDefault()
          setOver(null)
          if (dragging !== null) act.moveShot(dragging, reel.id, null)
          act.setDragging(null)
        }}
        className="folio-prod-add-shot"
      >
        ＋ Add shot
      </button>
    </div>
  )
}
