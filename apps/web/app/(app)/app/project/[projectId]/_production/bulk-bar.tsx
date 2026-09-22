'use client'

import { GENERATION_COSTS } from '@folio/contracts'

import { useProduction } from './production-context'

/**
 * §5.1, the bulk bar at the bottom centre while ≥1 shot is picked:
 * `{n} selected` · Status · Assign · Priority · `✦ Generate {n} frames ·
 * {4n} cr` · clear. The three menus apply to every picked shot.
 */
export const BulkBar = () => {
  const { picked, act, model, storage } = useProduction()
  const count = picked.size
  const ids = [...picked]
  const connected = model && storage
  const cost = GENERATION_COSTS.shot_frame * count
  return (
    <div role="toolbar" aria-label="Selected shots" data-bulk-bar data-production-root className="folio-prod-bulk">
      <span className="whitespace-nowrap px-[6px] text-12-5 text-ink2" data-bulk-count>
        {String(count)} selected
      </span>
      <span className="h-[18px] w-px bg-line" aria-hidden="true" />
      <button
        type="button"
        aria-haspopup="menu"
        data-bulk-status
        onClick={(event) => {
          act.openMenu('status', { kind: 'bulk' }, event)
        }}
        className="folio-prod-ghost"
      >
        Status
      </button>
      <button
        type="button"
        aria-haspopup="menu"
        data-bulk-assign
        onClick={(event) => {
          act.openMenu('assignee', { kind: 'bulk' }, event)
        }}
        className="folio-prod-ghost"
      >
        Assign
      </button>
      <button
        type="button"
        aria-haspopup="menu"
        data-bulk-priority
        onClick={(event) => {
          act.openMenu('priority', { kind: 'bulk' }, event)
        }}
        className="folio-prod-ghost"
      >
        Priority
      </button>
      <button
        type="button"
        data-bulk-generate
        aria-disabled={!connected}
        title={connected ? `Draw one frame per picked shot · ${String(cost)} cr` : model ? 'Image storage is not set up on this server yet' : 'The model is not connected'}
        onClick={() => {
          if (!connected) return
          act.generateFrames(ids)
        }}
        className="folio-prod-accent-small"
      >
        ✦ Generate {String(count)} {count === 1 ? 'frame' : 'frames'} · {String(cost)} cr
      </button>
      <button type="button" title="Clear selection" aria-label="Clear selection" data-bulk-clear onClick={act.clearPicked} className="folio-prod-x h-[28px] w-[28px]">
        ✕
      </button>
    </div>
  )
}
