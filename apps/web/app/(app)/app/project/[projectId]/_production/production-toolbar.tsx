'use client'

import type { RenderResolution } from '@folio/contracts'
import { RENDER_RESOLUTIONS } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { memo, useRef, useState } from 'react'

import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { useDismiss } from '../_chrome/use-dismiss'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'
import { Mark } from './mark'

/**
 * The Production toolbar row - `Route - Production v2.dc.html`: the route
 * name, the count chip (`2 reels in this scene`), the Scene | Episode pill
 * (the shared `_chrome/view-pill.tsx`, text shape, over `?view=`), then
 * `flex: 1`, the resolution control (`720p ▾`, a menu over the project's
 * `render_resolution`) and the credits chip (`◐ 220 cr`, orange when the
 * scene has a reel the balance cannot cover). Padding `12px 20px`, 10px
 * gaps, as the mockup's.
 */

export type ProductionView = 'scene' | 'episode'

export const PRODUCTION_VIEWS: readonly ViewPillItem<ProductionView>[] = [
  { id: 'scene', title: 'Scene' },
  { id: 'episode', title: 'Episode' },
]

const ResolutionMenu = memo(
  ({
    resolution,
    pending,
    onPick,
  }: {
    readonly resolution: RenderResolution
    readonly pending: boolean
    readonly onPick: (resolution: RenderResolution) => void
  }) => {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    useDismiss(open, () => setOpen(false), root)
    return (
      <div ref={root} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          data-resolution-menu
          disabled={pending}
          title="Every reel of the project renders at this resolution"
          className="folio-pill-button tabular flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[13px] text-12-5"
          onClick={() => {
            setOpen((value) => !value)
          }}
        >
          {resolution}
          <Icon name="chevron" size={11} strokeWidth={1.5} className="opacity-60" />
        </button>
        {open ? (
          <div role="menu" className="folio-menu absolute right-0 top-[40px] w-[180px]">
            {RENDER_RESOLUTIONS.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === resolution}
                data-resolution={value}
                className="folio-menu-item"
                onClick={() => {
                  setOpen(false)
                  if (value !== resolution) onPick(value)
                }}
              >
                <span className="min-w-0 flex-1">{value}</span>
                {value === resolution ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  },
)
ResolutionMenu.displayName = 'ResolutionMenu'

export const ProductionToolbar = memo(
  ({
    chip,
    view,
    baseHref,
    resolution,
    available,
    short,
    pending,
    onResolution,
  }: {
    /** `2 reels in this scene`. */
    readonly chip: string
    readonly view: ProductionView
    readonly baseHref: EpisodeRoutePath
    readonly resolution: RenderResolution
    readonly available: number
    /** The selected scene has a reel the balance cannot cover. */
    readonly short: boolean
    readonly pending: boolean
    readonly onResolution: (resolution: RenderResolution) => void
  }) => (
    <div data-production-toolbar className="flex flex-none flex-wrap items-center gap-[10px] px-[20px] py-[12px]">
      <span className="whitespace-nowrap text-14 font-medium tracking-title">Production</span>
      <span className="tabular whitespace-nowrap rounded-pill bg-s2 px-[10px] py-[4px] text-11-5 text-ink2" data-reels-chip>
        {chip}
      </span>
      <div className="ml-[4px]">
        <ViewPill label="Production views" shape="text" items={PRODUCTION_VIEWS} current={view} baseHref={baseHref} />
      </div>
      <div className="flex-1" />
      <ResolutionMenu resolution={resolution} pending={pending} onPick={onResolution} />
      <span
        title="Credits"
        data-credits-available={available}
        data-short={short ? 'true' : 'false'}
        className={`tabular flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] border px-[13px] text-12-5 ${
          short ? 'border-transparent bg-live-bg text-live' : 'border-line2 bg-s1 text-ink2'
        }`}
      >
        <Mark glyph="◐" /> {available} cr
      </span>
    </div>
  ),
)
ProductionToolbar.displayName = 'ProductionToolbar'
