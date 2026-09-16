'use client'

import { RESEARCH_SOURCE_KINDS } from '@folio/contracts'
import { memo } from 'react'

import { setResearchDrawer } from '../../../../../../lib/research/compose'
import type { KindFilter } from '../../../../../../lib/research/view'
import { kindFilterLabel } from '../../../../../../lib/research/view'
import { FilterMenu, NewButton, RecordToolbar } from '../_chrome/record-toolbar'

/**
 * The Research toolbar row - `Route - Research v2.dc.html`: the route name,
 * the count chip (`8 sources` / `7 clips`), `flex: 1`, `All types ▾` and
 * the solid `＋ Add source`. The row, the menu and the button are the
 * record routes' shared pieces (`_chrome/record-toolbar.tsx`). The
 * mockup's `Library · Source · Clips` pill followed the chip; since
 * 2026-09-17 it is the header's centre (`lib/workspace/views.ts`,
 * `_chrome/header-views.tsx`), as every route's views are.
 *
 * The mockup's type button cycles the five kinds on click; here it is a
 * menu, the shape the Characters and Locations toolbars give the same
 * control, so a kind is one click rather than up to five. Component state -
 * a way of looking, not an address.
 */
export type ResearchView = 'library' | 'source' | 'clips'

const KIND_OPTIONS: readonly KindFilter[] = ['all', ...RESEARCH_SOURCE_KINDS]

export const ResearchToolbar = memo(
  ({
    chip,
    kind,
    onKind,
  }: {
    readonly chip: string
    readonly kind: KindFilter
    readonly onKind: (kind: KindFilter) => void
  }) => (
    <RecordToolbar title="Research" total={chip} countAttr="data-research-count" attr="data-research-toolbar">
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
