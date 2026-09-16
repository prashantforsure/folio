'use client'

import { RESEARCH_SOURCE_KINDS } from '@folio/contracts'
import { memo } from 'react'

import { setResearchDrawer } from '../../../../../../lib/research/compose'
import type { KindFilter } from '../../../../../../lib/research/view'
import { kindFilterLabel } from '../../../../../../lib/research/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { FilterMenu, NewButton, RecordToolbar } from '../_chrome/record-toolbar'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * The Research toolbar row - `Route - Research v2.dc.html`: the route name,
 * the count chip (`8 sources` / `7 clips`), the `Library · Source · Clips`
 * pill (the shared `_chrome/view-pill.tsx`, text shape, over `?view=`),
 * `flex: 1`, `All types ▾` and the solid `＋ Add source`. The row, the menu
 * and the button are the record routes' shared pieces
 * (`_chrome/record-toolbar.tsx`).
 *
 * The mockup's type button cycles the five kinds on click; here it is a
 * menu, the shape the Characters and Locations toolbars give the same
 * control, so a kind is one click rather than up to five. Component state -
 * a way of looking, not an address.
 */
export type ResearchView = 'library' | 'source' | 'clips'

export const RESEARCH_VIEWS: readonly ViewPillItem<ResearchView>[] = [
  { id: 'library', title: 'Library' },
  { id: 'source', title: 'Source' },
  { id: 'clips', title: 'Clips' },
]

const KIND_OPTIONS: readonly KindFilter[] = ['all', ...RESEARCH_SOURCE_KINDS]

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
    <RecordToolbar
      title="Research"
      total={chip}
      countAttr="data-research-count"
      attr="data-research-toolbar"
      pill={<ViewPill label="Research views" shape="text" items={RESEARCH_VIEWS} current={view} baseHref={baseHref} />}
    >
      <FilterMenu value={kind} options={KIND_OPTIONS} label={kindFilterLabel} dividers={[1]} attr="data-kind-filter" onPick={onKind} />
      <NewButton
        attr="data-add-source"
        label="＋ Add source"
        onClick={() => {
          setResearchDrawer({ kind: 'new' })
        }}
      />
    </RecordToolbar>
  ),
)
ResearchToolbar.displayName = 'ResearchToolbar'
