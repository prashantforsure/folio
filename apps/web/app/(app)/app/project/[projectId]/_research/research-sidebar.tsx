'use client'

import type { ResearchClipRow, ResearchCollectionRow } from '@folio/contracts'
import { usePathname, useRouter } from 'next/navigation'

import type { CollectionFilter } from '../../../../../../lib/research/compose'
import { setCollectionFilter, setResearchDrawer, useCollectionFilter } from '../../../../../../lib/research/compose'
import { filedCount, filedWidget } from '../../../../../../lib/research/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { count } from '../../../../../../lib/workspace/format'
import { ProgressWidget, RecordGroup, RecordTitleRow, SidebarNote } from '../_chrome/record-sidebar'
import { collectionHue } from './kind'

/**
 * The Research sidebar's slots - `Route - Research v2.dc.html`: the
 * project's name with `+` (`Add source`), the recessed `Search sources and
 * clips` field (the shared `_chrome/find-field.tsx`), the `Collections`
 * group - `Everything` with an `--ink3` square, then one row per collection
 * with its coloured 6×6 dot, 13px name and count, the selected row on
 * `--s2` - and the `Clips filed N / M` widget with its bar and `K clips not
 * filed yet`. The title row, the group frame and the widget are the record
 * routes' shared pieces (`_chrome/record-sidebar.tsx`); the rows are this
 * route's. The layout hands them to the shared `Sidebar` card.
 *
 * ## A collection row filters, and returns to the library
 *
 * The mockup's `c.select` sets the filter and `view: "library"` in one
 * click. The filter is the cell in `lib/research/compose.ts` (the grid is
 * the page's, the row is the layout's); the view is the URL, so from a
 * source or the clips list the row also pushes the route's bare path. A
 * collection is `Everything` again when it is pruned from under the filter.
 */

export const ResearchTitleRow = ({ title }: { readonly title: string }) => (
  <RecordTitleRow
    title={title}
    action="Add source"
    attr="data-sidebar-add-source"
    onAction={() => {
      setResearchDrawer({ kind: 'new' })
    }}
  />
)

export const CollectionsGroup = ({
  collections,
  total,
  baseHref,
}: {
  readonly collections: readonly ResearchCollectionRow[]
  /** Every source, for the `Everything` row. */
  readonly total: number
  readonly baseHref: ProjectRoutePath
}) => {
  const router = useRouter()
  const pathname = usePathname()
  const selected = useCollectionFilter()
  const current: CollectionFilter = selected !== 'all' && !collections.some((row) => row.id === selected) ? 'all' : selected

  const pick = (filter: CollectionFilter): void => {
    setCollectionFilter(filter)
    if (pathname !== baseHref) router.push(baseHref)
  }

  const rows: readonly { readonly id: CollectionFilter; readonly name: string; readonly n: number; readonly colour: ResearchCollectionRow['colour'] | null }[] = [
    { id: 'all', name: 'Everything', n: total, colour: null },
    ...collections.map((row) => ({ id: row.id, name: row.name, n: row.sources, colour: row.colour })),
  ]

  return (
    <RecordGroup
      label="Collections"
      total={collections.length}
      attr={{ 'data-collections-group': '' }}
      countAttr="data-collections-count"
      empty={total === 0 ? <SidebarNote attr="data-collections-empty">Collections appear here as you file sources. Nothing to list yet.</SidebarNote> : undefined}
    >
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            data-collection-row={row.id}
            aria-current={row.id === current ? 'true' : undefined}
            onClick={() => {
              pick(row.id)
            }}
            className="folio-coll-row"
          >
            <span
              aria-hidden="true"
              className={`h-[6px] w-[6px] flex-none rounded-[2px] ${row.colour === null ? 'bg-ink3' : 'folio-coll-dot'}`}
              style={row.colour === null ? undefined : collectionHue(row.colour)}
            />
            <span className="min-w-0 flex-1 truncate text-13">{row.name}</span>
            <span className="tabular flex-none text-11 text-ink3">{count(row.n)}</span>
          </button>
        </li>
      ))}
    </RecordGroup>
  )
}

/** The `Clips filed N / M` widget pinned at the foot. */
export const FiledWidget = ({ clips }: { readonly clips: readonly Pick<ResearchClipRow, 'filings'>[] }) => {
  const widget = filedWidget(clips)
  return <ProgressWidget label="Clips filed" done={filedCount(clips)} total={clips.length} percent={widget.percent} note={widget.note} attr="filed" />
}
