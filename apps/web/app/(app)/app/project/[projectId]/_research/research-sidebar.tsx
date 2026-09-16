'use client'

import type { ResearchClipRow, ResearchCollectionRow } from '@folio/contracts'
import { usePathname, useRouter } from 'next/navigation'

import type { CollectionFilter } from '../../../../../../lib/research/compose'
import { setCollectionFilter, setResearchDrawer, useCollectionFilter } from '../../../../../../lib/research/compose'
import { filedWidget } from '../../../../../../lib/research/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { count } from '../../../../../../lib/workspace/format'
import { collectionHue } from './kind'

/**
 * The Research sidebar's slots - `Route - Research v2.dc.html`: the
 * project's name with `+` (`Add source`), the recessed `Search sources and
 * clips` field (the shared `_chrome/find-field.tsx`), the `Collections`
 * group - `Everything` with an `--ink3` square, then one row per collection
 * with its coloured 6×6 dot, 13px name and count, the selected row on
 * `--s2` - and the `Clips filed N / M` widget with its bar and `K clips not
 * filed yet`. The layout hands them to the shared `Sidebar` card
 * (`_chrome/sidebar.tsx`).
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
  <div className="flex flex-none items-center gap-[6px] pb-[10px] pl-[12px] pr-[12px] pt-[14px]">
    <span className="min-w-0 flex-1 truncate text-14 font-medium tracking-title">{title}</span>
    <button
      type="button"
      title="Add source"
      aria-label="Add source"
      data-sidebar-add-source
      onClick={() => {
        setResearchDrawer({ kind: 'new' })
      }}
      className="folio-ghost-button grid h-[24px] w-[24px] place-items-center rounded-[8px] text-15 leading-none text-ink3"
    >
      +
    </button>
  </div>
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
    <div className="flex flex-col gap-[3px]" data-collections-group>
      <div className="flex items-center pb-[6px] pl-[10px] pr-[10px] pt-[2px]">
        <span className="folio-eyebrow flex-1">Collections</span>
        <span className="tabular text-11 text-ink3" data-collections-count>
          {count(collections.length)}
        </span>
      </div>
      {total === 0 ? (
        <p className="m-0 ml-[10px] mr-[10px] mt-[2px] text-12 leading-[1.55] text-ink3" data-collections-empty>
          Collections appear here as you file sources. Nothing to list yet.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
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
        </ul>
      )}
    </div>
  )
}

/** The `Clips filed N / M` widget pinned at the foot. */
export const FiledWidget = ({ clips }: { readonly clips: readonly Pick<ResearchClipRow, 'filings'>[] }) => {
  const widget = filedWidget(clips)
  return (
    <div data-filed-card className="flex flex-col gap-[7px] rounded-card border border-line2 bg-s1 px-[12px] py-[11px]">
      <div className="flex items-baseline justify-between">
        <span className="text-12 text-ink2">Clips filed</span>
        <span className="tabular text-13 font-medium" data-filed-count>
          {widget.label}
        </span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-[3px] bg-s3">
        <div className="h-full rounded-[3px] bg-accent" style={{ width: `${String(widget.percent)}%` }} />
      </div>
      <span className="text-11 text-ink3" data-filed-note>
        {widget.note}
      </span>
    </div>
  )
}
