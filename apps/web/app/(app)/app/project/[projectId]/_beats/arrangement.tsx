'use client'

import type { BeatRow } from '@folio/contracts'
import { readBeatHeadline } from '@folio/script'
import Link from 'next/link'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useRef, useState } from 'react'

import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'

/**
 * The arrangement: story structure as time. `Route - Beats.dc.html`'s
 * `arrangement` view, transcribed - a placed track under a minute rule,
 * then the unplaced canvas on a dot grid, each with its own 28px tick row.
 *
 * ## Minutes are pixels
 *
 * `MINUTE_PX` at scale 1 is the bundle's 62px. A placed card sits at
 * `left = 16 + start × minute` and is `duration × minute` wide (no narrower
 * than an unplaced card, so a two-minute beat is still readable - flagged),
 * which is what makes the tick row mean something: the `10'` mark is where
 * a beat placed at 10 starts. The bundle lays its mock cards out in a flex
 * row; the brief says "a minute position on the episode timeline", and a
 * position is a `left`.
 *
 * ## Drag is pointer events, not HTML5 DnD
 *
 * A card is picked up on `pointerdown`, follows the pointer with capture,
 * and on `pointerup` lands where it is: over the track it is *placed* at the
 * minute under its left edge (`onPlace`); over the canvas it is *unplaced*
 * and its spot remembered (`onCanvas`). A press that moved less than a few
 * pixels is a click and selects. Nothing is written until the pointer is
 * released, and what is written is the row's timing, whole.
 *
 * The canvas toolbar is Fit / − / ＋ as text, per the Scenes precedent; the
 * bundle's `⌖` select and `✋` pan tools have no canvas to act on.
 */

export const MINUTE_PX = 62
export const TRACK_INSET_PX = 16
const CARD_WIDTH_PX = 236
const DEFAULT_SPOTS: readonly (readonly [number, number])[] = [
  [40, 34],
  [320, 132],
  [600, 60],
]
const CLICK_SLOP_PX = 4

export type ArrangementProps = {
  readonly beats: readonly BeatRow[]
  readonly selected: string | null
  readonly scale: number
  readonly sheetHref: EpisodeRoutePath
  readonly onSelect: (beatNodeId: string) => void
  readonly onPlace: (beatNodeId: string, minute: number) => void
  readonly onCanvas: (beatNodeId: string, x: number, y: number) => void
  readonly onScale: (scale: number) => void
}

type Drag = {
  readonly beatNodeId: string
  readonly startX: number
  readonly startY: number
  dx: number
  dy: number
  moved: boolean
  over: 'track' | 'canvas' | null
}

const spotOf = (beat: BeatRow, index: number): { readonly x: number; readonly y: number } => {
  if (beat.timing.canvas !== null) return beat.timing.canvas
  const spot = DEFAULT_SPOTS[index]
  return spot === undefined ? { x: 40 + index * 280, y: 34 } : { x: spot[0], y: spot[1] }
}

/** The 28px minute rule: a labelled tick every five minutes, the first on the fainter line. */
const TickRow = ({ ticks, minute, width }: { readonly ticks: readonly number[]; readonly minute: number; readonly width: number }) => (
  <div className="folio-beat-ticks" style={{ minWidth: width }}>
    {ticks.map((mark) => (
      <div
        key={mark}
        className="folio-beat-tick"
        style={{ left: Math.round(mark * minute + TRACK_INSET_PX), borderLeftColor: mark === 0 ? 'var(--line2)' : undefined }}
      >
        <span>{`${String(mark)}'`}</span>
      </div>
    ))}
  </div>
)

export const Arrangement = ({ beats, selected, scale, sheetHref, onSelect, onPlace, onCanvas, onScale }: ArrangementProps) => {
  const minute = MINUTE_PX * scale
  const placed = beats.filter((beat) => beat.timing.placedAtMinute !== null)
  const unplaced = beats.filter((beat) => beat.timing.placedAtMinute === null)
  const lastMinute = placed.reduce(
    (max, beat) => Math.max(max, (beat.timing.placedAtMinute ?? 0) + (beat.timing.durationMinutes ?? 0)),
    0,
  )
  const tickCount = Math.max(7, Math.ceil(lastMinute / 5) + 3)
  const ticks = Array.from({ length: tickCount }, (_, index) => index * 5)
  const trackWidth = TRACK_INSET_PX * 2 + Math.max(tickCount * 5 * minute, 0)

  const trackRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)

  const whereIs = useCallback((clientX: number, clientY: number): 'track' | 'canvas' | null => {
    const track = trackRef.current?.getBoundingClientRect()
    if (track !== undefined && clientX >= track.left && clientX <= track.right && clientY >= track.top && clientY <= track.bottom) return 'track'
    const canvas = canvasRef.current?.getBoundingClientRect()
    if (canvas !== undefined && clientX >= canvas.left && clientX <= canvas.right && clientY >= canvas.top && clientY <= canvas.bottom) return 'canvas'
    return null
  }, [])

  const pickUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, beatNodeId: string) => {
      if (event.button !== 0) return
      const target = event.currentTarget
      const next: Drag = {
        beatNodeId,
        startX: event.clientX,
        startY: event.clientY,
        dx: 0,
        dy: 0,
        moved: false,
        over: null,
      }
      dragRef.current = next
      setDrag({ ...next })
      target.setPointerCapture(event.pointerId)
    },
    [],
  )

  const move = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current
    if (current === null) return
    current.dx = event.clientX - current.startX
    current.dy = event.clientY - current.startY
    if (Math.abs(current.dx) > CLICK_SLOP_PX || Math.abs(current.dy) > CLICK_SLOP_PX) current.moved = true
    current.over = current.moved ? whereIs(event.clientX, event.clientY) : null
    setDrag({ ...current })
  }, [whereIs])

  const drop = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = dragRef.current
      if (current === null) return
      dragRef.current = null
      setDrag(null)
      event.currentTarget.releasePointerCapture(event.pointerId)
      onSelect(current.beatNodeId)
      if (!current.moved) return
      const rect = event.currentTarget.getBoundingClientRect()
      const over = whereIs(event.clientX, event.clientY)
      if (over === 'track') {
        const track = trackRef.current?.getBoundingClientRect()
        const scroll = trackRef.current?.scrollLeft ?? 0
        if (track === undefined) return
        const left = rect.left - track.left + scroll - TRACK_INSET_PX
        onPlace(current.beatNodeId, Math.max(0, Math.round(left / minute)))
        return
      }
      if (over === 'canvas') {
        const canvas = canvasRef.current?.getBoundingClientRect()
        if (canvas === undefined) return
        const x = Math.max(0, Math.round((rect.left - canvas.left + (canvasRef.current?.scrollLeft ?? 0)) / scale))
        const y = Math.max(0, Math.round((rect.top - canvas.top + (canvasRef.current?.scrollTop ?? 0)) / scale))
        onCanvas(current.beatNodeId, x, y)
      }
    },
    [minute, onCanvas, onPlace, onSelect, scale, whereIs],
  )

  const dragStyle = (beatNodeId: string): { readonly transform?: string } =>
    drag !== null && drag.beatNodeId === beatNodeId && drag.moved
      ? { transform: `translate(${String(drag.dx)}px, ${String(drag.dy)}px)` }
      : {}

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-arrangement>
      <div className="flex flex-none flex-col border-b border-line">
        <div className="overflow-x-auto" ref={trackRef} data-beat-track data-drop={drag?.over === 'track' ? 'true' : 'false'}>
          <TickRow ticks={ticks} minute={minute} width={trackWidth} />
          <div className="relative" style={{ minWidth: trackWidth, height: 190, padding: '14px 16px 16px' }}>
            {placed.length === 0 ? (
              <p className="m-0 px-[2px] pt-[6px] text-10-5 text-ink3">Nothing on the track. Drag a beat up from the canvas to place it.</p>
            ) : null}
            {placed.map((beat) => {
              const headline = readBeatHeadline(beat.text)
              const at = beat.timing.placedAtMinute ?? 0
              const duration = beat.timing.durationMinutes ?? 0
              return (
                <div
                  key={beat.beatNodeId}
                  data-placed-card={beat.beatNodeId}
                  data-dragging={drag?.beatNodeId === beat.beatNodeId && drag.moved ? 'true' : 'false'}
                  data-selected={selected === beat.beatNodeId ? 'true' : 'false'}
                  className="folio-beat-card absolute cursor-grab"
                  style={{
                    left: Math.round(TRACK_INSET_PX + at * minute),
                    top: 14,
                    width: Math.max(CARD_WIDTH_PX, Math.round(duration * minute)),
                    height: 160,
                    ...dragStyle(beat.beatNodeId),
                  }}
                  onPointerDown={(event) => {
                    pickUp(event, beat.beatNodeId)
                  }}
                  onPointerMove={move}
                  onPointerUp={drop}
                >
                  <span className="folio-beat-colour bg-accent" />
                  <div className="flex flex-col gap-[4px]">
                    <span className="font-serif text-16 font-medium leading-[1.2]">{headline.name === '' ? 'Untitled beat' : headline.name}</span>
                    <span className="line-clamp-2 text-11-5 leading-[1.45] text-ink2">{headline.line}</span>
                  </div>
                  <div className="min-h-[14px] flex-1" />
                  <div className="flex items-center gap-[8px]">
                    <span className="folio-beat-minutes">{beat.timing.durationMinutes === null ? '—' : `${String(beat.timing.durationMinutes)}m`}</span>
                    <span className="text-10 text-ink3">{`${String(at)}'–${String(at + duration)}'`}</span>
                    <div className="flex-1" />
                    <Link
                      href={sheetHref}
                      className="folio-focus flex items-center gap-[6px] rounded-chrome border border-line px-[9px] py-[4px] text-11 text-ink2 no-underline hover:bg-hover hover:no-underline"
                      onPointerDown={(event) => {
                        event.stopPropagation()
                      }}
                      onClick={() => {
                        onSelect(beat.beatNodeId)
                      }}
                    >
                      <span className="font-glyph text-10 opacity-70">✎</span>Edit beat
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <TickRow ticks={ticks} minute={minute} width={trackWidth} />
        <div className="flex flex-none items-center gap-[8px] overflow-hidden border-b border-line2 bg-panel px-[16px] py-[6px] text-10-5 text-ink2">
          <span className="h-[5px] w-[5px] flex-none rounded-full bg-note" />
          <span className="min-w-0 truncate" data-unplaced-note>
            {unplaced.length} unplaced beat{unplaced.length === 1 ? '' : 's'} live here until you drag them onto the track
          </span>
        </div>
        <div
          ref={canvasRef}
          data-beat-canvas
          data-drop={drag?.over === 'canvas' ? 'true' : 'false'}
          className="folio-beat-canvas relative min-h-0 flex-1 overflow-auto"
          style={{ backgroundSize: `${String(Math.round(22 * scale))}px ${String(Math.round(22 * scale))}px` }}
        >
          <div className="relative" style={{ minHeight: 420, minWidth: 900 }}>
            {unplaced.map((beat, index) => {
              const headline = readBeatHeadline(beat.text)
              const spot = spotOf(beat, index)
              return (
                <div
                  key={beat.beatNodeId}
                  data-unplaced-card={beat.beatNodeId}
                  data-dragging={drag?.beatNodeId === beat.beatNodeId && drag.moved ? 'true' : 'false'}
                  data-selected={selected === beat.beatNodeId ? 'true' : 'false'}
                  className="folio-beat-card absolute cursor-grab !gap-[8px] !px-[12px] !py-[11px]"
                  style={{
                    left: Math.round(spot.x * scale),
                    top: Math.round(spot.y * scale),
                    width: CARD_WIDTH_PX,
                    ...dragStyle(beat.beatNodeId),
                  }}
                  onPointerDown={(event) => {
                    pickUp(event, beat.beatNodeId)
                  }}
                  onPointerMove={move}
                  onPointerUp={drop}
                >
                  <div className="flex items-center gap-[8px]">
                    <span className="folio-beat-colour !w-[20px] bg-note" />
                    <span className="flex-1 font-serif text-15 font-medium">{headline.name === '' ? 'Untitled beat' : headline.name}</span>
                    <span className="text-9-5 text-ink3">unplaced</span>
                  </div>
                  <span className="line-clamp-3 text-11-5 leading-[1.45] text-ink2">{headline.line}</span>
                  <div className="flex items-center gap-[7px]">
                    <span className="folio-beat-minutes">{beat.timing.durationMinutes === null ? '—' : `${String(beat.timing.durationMinutes)}m`}</span>
                    <span className="text-10 text-ink3">drag onto the track to place</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="sticky bottom-0 float-right z-10 mb-[12px] mr-[14px] flex items-center gap-[1px] rounded-chrome border border-line bg-panel p-[3px]" data-canvas-tools>
            <button
              type="button"
              title="Fit to content"
              className="folio-focus h-[26px] rounded-chrome px-[8px] text-11 text-ink2 hover:bg-hover"
              onClick={() => {
                onScale(1)
              }}
            >
              Fit
            </button>
            <button
              type="button"
              title="Zoom out"
              className="folio-focus h-[26px] w-[28px] rounded-chrome text-12 text-ink2 hover:bg-hover"
              onClick={() => {
                onScale(Math.max(0.5, Math.round((scale - 0.25) * 100) / 100))
              }}
            >
              −
            </button>
            <button
              type="button"
              title="Zoom in"
              className="folio-focus h-[26px] w-[28px] rounded-chrome text-12 text-ink2 hover:bg-hover"
              onClick={() => {
                onScale(Math.min(2, Math.round((scale + 0.25) * 100) / 100))
              }}
            >
              ＋
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
