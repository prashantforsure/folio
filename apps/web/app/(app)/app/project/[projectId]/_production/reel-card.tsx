'use client'

import type { ProductionScene, Reel } from '@folio/contracts'
import { CLIP_LENGTHS, REEL_STATUS_LABELS } from '@folio/contracts'
import { useRef, useState } from 'react'

import { reelTiming } from '../../../../../../lib/production/derive'
import { useDismiss } from '../_chrome/use-dismiss'
import { useFocusTrap } from '../_chrome/use-focus-trap'
import { useProduction } from './production-context'
import { ReadinessBar } from './readiness-bar'
import { SceneImage } from './scene-image'
import { SceneSetup } from './scene-setup'
import { SheetColumn } from './sheet-column'
import { Shotlist } from './shotlist'
import { TimingBar } from './timing-bar'

/**
 * §3, one reel's card: the header (§3.1), the timing bar (§3.2), the
 * shotlist beside the storyboard sheet (§3.3–3.4), the scene setup beside
 * the scene image (§3.5–3.6), and the readiness bar with the shoot button
 * (§3.7). The `⋯` menu is Rename reel · Delete reel (the client's ruling).
 */
const STATUS_TONE: Readonly<Record<Reel['status'], 'ok' | 'accent' | 'warn' | 'none'>> = {
  rendered: 'ok',
  generating: 'accent',
  stale: 'warn',
  writing: 'none',
}

export const ReelCard = ({ scene, reel }: { readonly scene: ProductionScene; readonly reel: Reel }) => {
  const { act } = useProduction()
  const timing = reelTiming(reel)
  return (
    <div className="folio-prod-reel" data-reel-card={reel.id} data-reel-status={reel.status}>
      <div className="folio-prod-reel-head">
        <span className="flex items-center gap-[8px] whitespace-nowrap text-13-5 font-medium">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" className="text-ink3" aria-hidden="true">
            <rect x="2.6" y="5" width="14.8" height="10" rx="2" />
            <path d="M6.6 5v10M13.4 5v10" />
          </svg>
          {reel.name}
        </span>
        <span className="folio-prod-pill" data-tone={STATUS_TONE[reel.status]} data-reel-status-pill>
          {REEL_STATUS_LABELS[reel.status]}
        </span>
        <span className="h-[16px] w-px bg-line" aria-hidden="true" />
        <span className="whitespace-nowrap text-11-5 text-ink3">Clip length</span>
        <span role="group" aria-label="Clip length" className="folio-prod-clip">
          {CLIP_LENGTHS.map((seconds) => (
            <button
              key={seconds}
              type="button"
              aria-pressed={reel.clipLengthS === seconds}
              data-clip-length={seconds}
              onClick={() => {
                act.setClipLength(reel.id, seconds)
              }}
            >
              {String(seconds)}s
            </button>
          ))}
        </span>
        <span className="flex-1" />
        <span className="folio-prod-time" data-tone={timing.tone} data-reel-time>
          {String(timing.used)} / {String(timing.target)} s
        </span>
        <ReelMenu reel={reel} />
      </div>

      <TimingBar reel={reel} />

      <div className="flex flex-wrap items-start gap-[14px]">
        <Shotlist reel={reel} />
        <SheetColumn reel={reel} />
      </div>

      <div className="flex flex-wrap items-stretch gap-[14px]">
        <SceneSetup scene={scene} />
        <SceneImage scene={scene} />
      </div>

      <ReadinessBar scene={scene} reel={reel} />
    </div>
  )
}

const ReelMenu = ({ reel }: { readonly reel: Reel }) => {
  const { act } = useProduction()
  const [open, setOpen] = useState<'menu' | 'rename' | null>(null)
  const [name, setName] = useState(reel.name)
  const root = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useDismiss(open !== null, () => {
    setOpen(null)
  }, root)
  useFocusTrap(panel, open !== null)
  return (
    <span ref={root} className="relative">
      <button
        type="button"
        title="More"
        aria-label={`More for ${reel.name}`}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        data-reel-menu
        onClick={() => {
          setName(reel.name)
          setOpen(open === null ? 'menu' : null)
        }}
        className="folio-prod-x h-[28px] w-[28px] text-14"
      >
        ⋯
      </button>
      {open === 'menu' ? (
        <div ref={panel} role="menu" aria-label={`${reel.name} menu`} className="folio-prod-menu absolute right-0 top-[32px] w-[200px]">
          <button
            type="button"
            role="menuitem"
            data-reel-rename
            onClick={() => {
              setOpen('rename')
            }}
            className="folio-prod-menu-item"
          >
            Rename reel
          </button>
          <button
            type="button"
            role="menuitem"
            data-reel-delete
            onClick={() => {
              setOpen(null)
              act.deleteReel(reel.id)
            }}
            className="folio-prod-menu-item"
            data-tone="bad"
          >
            Delete reel
          </button>
        </div>
      ) : null}
      {open === 'rename' ? (
        <form
          ref={panel as never}
          role="dialog"
          aria-label="Rename reel"
          className="folio-prod-menu absolute right-0 top-[32px] flex w-[240px] flex-col gap-[8px]"
          onSubmit={(event) => {
            event.preventDefault()
            const next = name.trim()
            if (next.length > 0 && next !== reel.name) act.renameReel(reel.id, next)
            setOpen(null)
          }}
        >
          <input
            value={name}
            aria-label="Reel name"
            data-reel-name-input
            autoFocus
            onChange={(event) => {
              setName(event.target.value)
            }}
            className="folio-prod-input"
          />
          <div className="flex gap-[6px]">
            <button type="submit" className="folio-prod-solid-small flex-1">
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(null)
              }}
              className="folio-prod-line-small"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </span>
  )
}
