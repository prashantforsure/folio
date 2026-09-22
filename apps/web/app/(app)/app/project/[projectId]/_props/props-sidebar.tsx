'use client'

import type { ProjectId, PropStatus } from '@folio/contracts'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'

import { setNewPropOpen } from '../../../../../../lib/props/compose'
import type { PropSidebarRow } from '../../../../../../lib/props/view'
import { grouped, matchesFind, sourcedLine, statusTone } from '../../../../../../lib/props/view'
import { count } from '../../../../../../lib/workspace/format'
import { propHref } from '../../../../../../lib/workspace/hrefs'
import { FindField, useFind } from '../_chrome/find-field'
import { CountsWidget, RecordGroup, RecordTitleRow, SidebarNote } from '../_chrome/record-sidebar'

/**
 * The Props sidebar's four slots, on the record routes' shared pieces
 * (`_chrome/record-sidebar.tsx`): the project's name with `+` (`New
 * prop`), the recessed `Find a prop or spelling` field, the grouped list,
 * and the foot widget.
 *
 * ## Groups are categories
 *
 * Locations groups by kind and Characters by status; this route groups by
 * **category**, because a category is the only grouping a writer here has
 * actually authored, and the status is already the dot on every row.
 * Categories sort alphabetically with `Uncategorised` last
 * (`lib/props/view.ts`, `grouped`). A row: the status dot, the name over
 * its lines-and-scenes line, and the scene count in mono.
 *
 * ## The find field filters the list it sits above, and the body
 *
 * The field narrows the groups below it by name, category or bound
 * spelling (`matchesFind`) - and the grid and the list too, since the
 * workspace reads the same `useFind`.
 *
 * ## Which row is lit
 *
 * The drawer is `/props/:id`, so the selected record is the URL and
 * `useSelectedLayoutSegment` reads it from under the route's layout - no
 * cell to publish, and the first paint agrees with the page.
 */

export const PropTitleRow = ({ title }: { readonly title: string }) => (
  <RecordTitleRow
    title={title}
    action="New prop"
    attr="data-sidebar-new-prop"
    onAction={() => {
      setNewPropOpen(true)
    }}
  />
)

export const PropFind = () => <FindField placeholder="Find a prop or spelling" testId="prop-find" />

/** `4 lines · 2 scenes`, or the README's line for a record the page never writes about. */
const rowLine = (row: PropSidebarRow): string =>
  row.lines === 0
    ? 'Not on the page yet'
    : `${String(row.lines)} ${row.lines === 1 ? 'line' : 'lines'} · ${String(row.scenes)} ${row.scenes === 1 ? 'scene' : 'scenes'}`

export const PropGroups = ({ projectId, rows }: { readonly projectId: ProjectId; readonly rows: readonly PropSidebarRow[] }) => {
  const { query } = useFind()
  const selected = useSelectedLayoutSegment()
  const groups = grouped(rows)
    .map((group) => ({ ...group, rows: group.rows.filter((row) => matchesFind(row, query)) }))
    .filter((group) => group.rows.length > 0)

  if (rows.length === 0) {
    return (
      <SidebarNote attr="data-props-empty">
        A prop is something the film has to put in front of the camera. Nothing is listed yet.
      </SidebarNote>
    )
  }
  if (groups.length === 0) {
    return <SidebarNote attr="data-props-no-match">No prop matches that.</SidebarNote>
  }

  return (
    <div className="flex flex-col gap-[16px]" data-prop-groups>
      {groups.map(({ group, rows: items }) => (
        <RecordGroup key={group} label={group} total={items.length} attr={{ 'data-prop-group': group }}>
          {items.map((row) => (
            <li key={row.id}>
              <Link
                href={propHref(projectId, row.id)}
                data-prop-row={row.id}
                aria-current={row.id === selected ? 'page' : undefined}
                className="folio-record-row"
              >
                <span className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full" data-tone={statusTone(row.status)} />
                <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="truncate text-13">{row.name}</span>
                  <span className="truncate font-mono text-10-5 text-ink3" data-row-line>
                    {rowLine(row)}
                  </span>
                </span>
                <span className="tabular flex-none font-mono text-11 text-ink3">{count(row.scenes)} sc</span>
              </Link>
            </li>
          ))}
        </RecordGroup>
      ))}
    </div>
  )
}

/** The foot widget: `Sourced · 4 of 6` over `On the page · 5 of 6`. */
export const PropFootWidget = ({ rows }: { readonly rows: readonly { readonly status: PropStatus; readonly lines: number }[] }) => {
  const onPage = rows.filter((row) => row.lines > 0).length
  return (
    <CountsWidget
      attr="props"
      rows={[
        { label: 'Sourced', value: sourcedLine(rows), attr: 'data-sourced-count' },
        { label: 'On the page', value: `${String(onPage)} of ${String(rows.length)}`, attr: 'data-on-page-count' },
      ]}
    />
  )
}
