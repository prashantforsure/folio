'use client'

import type { ProjectId, PropRow } from '@folio/contracts'
import Link from 'next/link'
import { useMemo } from 'react'

import type { Sort, SortKey } from '../../../../../../lib/props/view'
import { sorted, statusLabel, statusTone } from '../../../../../../lib/props/view'
import { propHref } from '../../../../../../lib/workspace/hrefs'
import { PropThumb } from './prop-card'

/**
 * The List: `Name ⇅ · Category ⇅ · Description`, one row per record, the
 * description truncated to one line with the thumbnail beside the name.
 *
 * ## The sort is on the columns, not in a menu
 *
 * Two sortable headers, each a button that toggles its direction and takes
 * the sort when it is another column's (`lib/props/view.ts`, `sorted` - a
 * blank category sorts last whichever way the column points, and the name
 * is always the tie-break, so the order is total and a re-render cannot
 * reshuffle equal rows). Component state, like every other way of looking
 * on this route.
 *
 * A row is a link to `/props/:id`, so the whole row opens the drawer and a
 * middle-click opens a tab; the status is a dot with its label as the
 * title, the same dot the card and the sidebar draw.
 */
export const ListView = ({
  projectId,
  shown,
  sort,
  onSort,
  selectedId,
  onShowAll,
  total,
}: {
  readonly projectId: ProjectId
  readonly shown: readonly PropRow[]
  readonly sort: Sort
  readonly onSort: (sort: Sort) => void
  readonly selectedId: string | null
  readonly onShowAll: () => void
  readonly total: number
}) => {
  const rows = useMemo(() => sorted(shown, sort), [shown, sort])
  const pick = (key: SortKey): void => {
    onSort(sort.key === key ? { key, descending: !sort.descending } : { key, descending: false })
  }
  const heading = (key: SortKey, label: string) => (
    <button
      type="button"
      data-sort-by={key}
      data-sort-direction={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : undefined}
      aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
      onClick={() => {
        pick(key)
      }}
      className="folio-eyebrow flex items-center gap-[4px] bg-transparent hover:text-ink2"
    >
      {label}
      <span aria-hidden="true" className={sort.key === key ? 'text-ink2' : 'opacity-40'}>
        ⇅
      </span>
    </button>
  )

  return (
    <div data-list-view className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[24px]">
      <table className="w-full border-collapse text-left" data-props-table>
        <thead>
          <tr className="border-b border-line2">
            <th scope="col" className="w-[30%] py-[8px] pr-[12px] font-normal">
              {heading('name', 'Name')}
            </th>
            <th scope="col" className="w-[20%] py-[8px] pr-[12px] font-normal">
              {heading('category', 'Category')}
            </th>
            <th scope="col" className="py-[8px] font-normal">
              <span className="folio-eyebrow">Description</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-prop-listrow={row.id} aria-current={row.id === selectedId ? 'true' : undefined} className="border-b border-line2 last:border-0 hover:bg-s1">
              <td className="py-[9px] pr-[12px] align-middle">
                <Link href={propHref(projectId, row.id)} data-listrow-link className="flex min-w-0 items-center gap-[8px] text-13 no-underline hover:no-underline">
                  <PropThumb id={row.id} name={row.name} photoUrl={row.photoUrl} size={22} />
                  <span
                    className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full"
                    data-tone={statusTone(row.status)}
                    title={statusLabel(row.status)}
                  />
                  <span className="min-w-0 truncate">{row.name}</span>
                </Link>
              </td>
              <td className="py-[9px] pr-[12px] align-middle text-12-5 text-ink2" data-listrow-category>
                {row.category ?? <span className="text-ink3">—</span>}
              </td>
              <td className="py-[9px] align-middle text-12-5 text-ink2" data-listrow-description>
                <span className="block max-w-full truncate">
                  {row.description ?? <span className="text-ink3">{row.evidence[0]?.text ?? '—'}</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && total > 0 ? (
        <p className="m-0 pt-[12px] text-12-5 text-ink3" data-props-filtered-empty>
          No prop matches that filter.{' '}
          <button type="button" data-show-all onClick={onShowAll} className="text-accent hover:underline">
            Show all
          </button>
        </p>
      ) : null}
    </div>
  )
}
