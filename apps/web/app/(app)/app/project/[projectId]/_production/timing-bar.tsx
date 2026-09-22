'use client'

import type { Reel, ReelShotId } from '@folio/contracts'
import { useRef } from 'react'

import { clampRetime, reelTiming, secondsOf, segmentTone } from '../../../../../../lib/production/derive'
import { useProduction } from './production-context'

/**
 * §3.2, the timing bar: one segment per shot, width `duration /
 * max(clipLength, total)`, the four-colour cycle, a proposal as a hatched
 * warn outline, a dashed `{n}s free` remainder. Each segment's 9px right
 * handle retimes by pointer drag, clamped to `1 … min(clip, 15) −
 * others`, whole seconds; the same handle is a slider for the keyboard -
 * `←` / `→` step a second, `Home` / `End` go to the ends.
 */
export const TimingBar = ({ reel }: { readonly reel: Reel }) => {
  const { act, resizing } = useProduction()
  const bar = useRef<HTMLDivElement>(null)
  const timing = reelTiming(reel)

  const grab = (shotId: ReelShotId, event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const element = bar.current
    if (element === null) return
    const target = reel.shots.find((shot) => shot.id === shotId)
    if (target === undefined) return
    const start = secondsOf(target)
    const others = reel.shots.filter((shot) => shot.id !== shotId).reduce((total, shot) => total + secondsOf(shot), 0)
    const pxPerSec = element.getBoundingClientRect().width / Math.max(timing.target, others + start)
    const x0 = event.clientX
    let last = start
    const move = (ev: PointerEvent): void => {
      const next = clampRetime(reel, shotId, start + (ev.clientX - x0) / pxPerSec)
      if (next === last) return
      last = next
      act.previewRetime(reel.id, shotId, next)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      act.commitRetime(shotId, last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    act.previewRetime(reel.id, shotId, start)
  }

  const nudge = (shotId: ReelShotId, key: string): boolean => {
    const target = reel.shots.find((shot) => shot.id === shotId)
    if (target === undefined) return false
    const current = secondsOf(target)
    const next =
      key === 'ArrowLeft' || key === 'ArrowDown' ? current - 1 : key === 'ArrowRight' || key === 'ArrowUp' ? current + 1 : key === 'Home' ? 1 : key === 'End' ? 15 : null
    if (next === null) return false
    act.commitRetime(shotId, clampRetime(reel, shotId, next))
    return true
  }

  return (
    <div ref={bar} className="folio-prod-bar" data-timing-bar>
      {timing.segments.map((segment) => {
        const max = Math.max(1, Math.min(reel.clipLengthS, 15) - (timing.total - segment.seconds))
        return (
          <span
            key={segment.shotId}
            title={`Shot ${String(segment.index + 1)} · ${String(segment.seconds)} s — drag the edge to retime`}
            className="folio-prod-seg"
            data-tone={segment.proposed ? 'proposed' : segmentTone(segment.index)}
            data-segment={segment.index + 1}
            style={{ width: segment.width }}
          >
            <span className="folio-prod-seg-label">{String(segment.seconds)}s</span>
            <span
              role="slider"
              tabIndex={0}
              aria-label={`Shot ${String(segment.index + 1)} duration`}
              aria-valuemin={1}
              aria-valuemax={max}
              aria-valuenow={segment.seconds}
              aria-valuetext={`${String(segment.seconds)} seconds`}
              title="Drag to retime"
              data-retime-handle
              data-active={resizing === segment.shotId ? 'true' : undefined}
              onPointerDown={(event) => {
                grab(segment.shotId, event)
              }}
              onKeyDown={(event) => {
                if (nudge(segment.shotId, event.key)) event.preventDefault()
              }}
              className="folio-prod-seg-handle"
            />
          </span>
        )
      })}
      {timing.rest > 0 ? (
        <span className="folio-prod-seg-rest" style={{ width: timing.restWidth }} data-free>
          {String(timing.rest)}s free
        </span>
      ) : null}
    </div>
  )
}
