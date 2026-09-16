'use client'

import { RESEARCH_SOURCE_KINDS } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { memo, useRef, useState } from 'react'

import { setResearchDrawer } from '../../../../../../lib/research/compose'
import type { KindFilter } from '../../../../../../lib/research/view'
import { kindFilterLabel } from '../../../../../../lib/research/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { useDismiss } from '../_chrome/use-dismiss'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'
import { KindGlyph } from './kind'

/**
 * The Research toolbar row - `Route - Research v2.dc.html`: the route name,
 * the count chip (`8 sources` / `7 clips`), the `Library · Source · Clips`
 * pill (the shared `_chrome/view-pill.tsx`, text shape, over `?view=`),
 * `flex: 1`, `All types ▾` and the solid `＋ Add source`. `12px 20px`, 10px
 * gaps.
 *
 * The mockup's type button cycles the five kinds on click; here it is a
 * menu, the shape the Characters and Storyboard toolbars give the same
 * control, so a kind is one click rather than up to five. Component state -
 * a way of looking, not an address.
 */
export type ResearchView = 'library' | 'source' | 'clips'

export const RESEARCH_VIEWS: readonly ViewPillItem<ResearchView>[] = [
  { id: 'library', title: 'Library' },
  { id: 'source', title: 'Source' },
  { id: 'clips', title: 'Clips' },
]

const KindMenu = memo(({ kind, onPick }: { readonly kind: KindFilter; readonly onPick: (kind: KindFilter) => void }) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), root)
  const options: readonly KindFilter[] = ['all', ...RESEARCH_SOURCE_KINDS]
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-kind-filter={kind}
        className="folio-pill-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[13px] text-12-5"
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        {kindFilterLabel(kind)}
        <Icon name="chevron" size={11} strokeWidth={1.5} className="opacity-60" />
      </button>
      {open ? (
        <div role="menu" className="folio-menu absolute right-0 top-[40px] w-[200px]">
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === kind}
              data-kind-option={option}
              className={`folio-menu-item ${index === 1 ? 'mt-[4px] border-t border-line2 pt-[10px]' : ''}`}
              onClick={() => {
                setOpen(false)
                onPick(option)
              }}
            >
              {option === 'all' ? null : (
                <span className="w-[12px] flex-none text-center text-12">
                  <KindGlyph kind={option} />
                </span>
              )}
              <span className="min-w-0 flex-1">{kindFilterLabel(option)}</span>
              {option === kind ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
})
KindMenu.displayName = 'KindMenu'

export const ResearchToolbar = memo(
  ({
    chip,
    view,
    baseHref,
    kind,
    onKind,
  }: {
    readonly chip: string
    readonly view: ResearchView
    readonly baseHref: ProjectRoutePath
    readonly kind: KindFilter
    readonly onKind: (kind: KindFilter) => void
  }) => (
    <div data-research-toolbar className="flex flex-none flex-wrap items-center gap-[10px] px-[20px] py-[12px]">
      <h1 className="m-0 whitespace-nowrap text-14 font-medium leading-normal tracking-title">Research</h1>
      <span className="tabular whitespace-nowrap rounded-pill bg-s2 px-[10px] py-[4px] text-11-5 text-ink2" data-research-count>
        {chip}
      </span>
      <div className="ml-[4px] min-w-0">
        <ViewPill label="Research views" shape="text" items={RESEARCH_VIEWS} current={view} baseHref={baseHref} />
      </div>
      <div className="flex-1" />
      <KindMenu kind={kind} onPick={onKind} />
      <button
        type="button"
        data-add-source
        onClick={() => {
          setResearchDrawer({ kind: 'new' })
        }}
        className="folio-solid-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[14px] text-12-5 font-medium"
      >
        ＋ Add source
      </button>
    </div>
  ),
)
ResearchToolbar.displayName = 'ResearchToolbar'
