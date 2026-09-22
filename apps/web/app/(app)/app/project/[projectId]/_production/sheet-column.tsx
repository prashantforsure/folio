'use client'

import type { Reel } from '@folio/contracts'
import { GENERATION_COSTS, SHEET_STATE_LABELS } from '@folio/contracts'

import { sheetCameraNote, sheetHeading, sheetTime } from '../../../../../../lib/production/camera'
import { shotClocks } from '../../../../../../lib/production/derive'
import { useProduction } from './production-context'

/**
 * §3.4, the storyboard sheet column (`flex: 1 1 320px`, max 440px): the
 * header (`STORYBOARD SHEET` · state pill · `{n} frames · 1 image`), the
 * sheet - the blocking plate (the generated image, once there is one)
 * over one row per shot (frame 55% + mono note 45%) - and the action
 * button through its three labels. `none` shows the first two rows under
 * the "No storyboard yet" overlay; `gen` dims it and draws the progress
 * bar; `done` shows every row.
 */
const COST = GENERATION_COSTS.storyboard_sheet

export const SheetColumn = ({ reel }: { readonly reel: Reel }) => {
  const { act, model, storage, live } = useProduction()
  const state = reel.sheet?.state ?? 'none'
  const clocks = shotClocks(reel)
  const rows = state === 'none' ? reel.shots.slice(0, 2) : reel.shots
  const generation = live.find((candidate) => candidate.job === 'storyboard_sheet' && candidate.targetId === reel.id) ?? null
  const progress = reel.sheet?.progress ?? generation?.progress ?? 0
  const connected = model && storage
  const disabled = reel.shots.length === 0 || state === 'gen'
  const label = state === 'done' ? `✦ Redraw sheet · ${String(COST)} cr` : state === 'gen' ? '◌ Drawing sheet…' : `✦ AI Storyboard · ${String(COST)} cr`
  const title = !connected
    ? model
      ? 'Image storage is not set up on this server yet'
      : 'The model is not connected'
    : reel.shots.length === 0
      ? 'Add shots first - the sheet is drawn from the shotlist'
      : state === 'gen'
        ? 'The sheet is being drawn'
        : `${state === 'done' ? 'Redraw' : 'Draw'} one sheet for all ${String(reel.shots.length)} shots`
  const tone = state === 'done' ? 'ok' : state === 'gen' ? 'accent' : 'none'

  return (
    <div className="folio-prod-sheet-col" data-sheet-column data-sheet-state={state}>
      <div className="flex items-center gap-[8px] px-[2px] pt-[2px]">
        <span className="folio-prod-eyebrow">Storyboard sheet</span>
        <span className="folio-prod-pill folio-prod-pill-sm" data-tone={tone} data-sheet-pill>
          {SHEET_STATE_LABELS[state]}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-10-5 text-ink3">{reel.shots.length > 0 ? `${String(reel.shots.length)} frames · 1 image` : 'no shots yet'}</span>
      </div>

      <div className="folio-prod-sheet" data-state={state}>
        <span className="folio-prod-plate" data-plate style={reel.sheet?.asset?.url ? { backgroundImage: `url(${reel.sheet.asset.url})` } : undefined}>
          {reel.sheet?.asset?.url ? null : 'top-down blocking · camera paths'}
        </span>
        {rows.map((shot, index) => {
          const clock = clocks.find((entry) => entry.shotId === shot.id)
          const frame = reel.sheet?.frames.find((row) => row.shotId === shot.id)?.asset?.url ?? shot.frame?.url ?? null
          return (
            <span key={shot.id} className="folio-prod-sheet-row" data-sheet-row={index + 1}>
              <span className="folio-prod-sheet-frame" data-drawn={frame === null ? undefined : 'true'} style={frame === null ? undefined : { backgroundImage: `url(${frame})` }} />
              <span className="folio-prod-sheet-note">
                <span className="truncate tracking-[.02em]">{sheetHeading(index, shot)}</span>
                <span className="opacity-[.62]">{sheetCameraNote(shot)}</span>
                <span className="opacity-[.62]">{sheetTime(clock?.from ?? 0, clock?.to ?? 0)}</span>
              </span>
            </span>
          )
        })}
        {state === 'none' ? (
          <span className="folio-prod-sheet-overlay" data-sheet-overlay>
            <span className="text-12-5">No storyboard yet</span>
            <span className="font-mono text-10-5 leading-[1.6] opacity-[.6]">
              {reel.shots.length > 0
                ? `One sheet covers all ${String(reel.shots.length)} shots — blocking plan plus a frame and camera note per shot.`
                : 'Add shots first — the sheet is drawn from the shotlist.'}
            </span>
          </span>
        ) : null}
        {state === 'gen' ? (
          <span className="folio-prod-progress" role="progressbar" aria-label="Drawing the sheet" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${String(progress)}%` }} />
          </span>
        ) : null}
      </div>

      <div className="mt-auto flex gap-[8px]">
        <button
          type="button"
          data-generate-sheet
          aria-disabled={disabled || !connected}
          title={title}
          onClick={() => {
            if (disabled || !connected) return
            act.generateSheet(reel.id)
          }}
          className="folio-prod-sheet-button"
          data-done={state === 'done' ? 'true' : undefined}
        >
          {label}
        </button>
        {generation !== null ? (
          <button
            type="button"
            data-cancel-sheet
            title="Stop drawing"
            aria-label="Stop drawing the sheet"
            onClick={() => {
              act.cancelGeneration(generation.id)
            }}
            className="folio-prod-line-small h-[38px]"
          >
            Stop
          </button>
        ) : null}
      </div>
    </div>
  )
}
