'use client'

import type { LocationRow, LocationStatus, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'

import { setNewLocationOpen } from '../../../../../../lib/locations/compose'
import { LOCATION_GROUP_LABELS, grouped, matchesFind, scoutedOf, statusTone } from '../../../../../../lib/locations/view'
import { count } from '../../../../../../lib/workspace/format'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import { FindField, useFind } from '../_chrome/find-field'
import { ProgressWidget, RecordGroup, RecordTitleRow, SidebarNote } from '../_chrome/record-sidebar'

/**
 * The Locations sidebar's four slots - `Route - Locations v2.dc.html`: the
 * project's name with `+` (`New location`), the recessed `Find a location
 * or slugline` field, the grouped list (`Primary set` · `Recurring` ·
 * `One-off`, an eyebrow and a count each; a 6px status dot, the name over
 * the mono `INT/EXT`, the scene count), and the `Scouted N / M` widget with
 * its bar and `2 still pending`. The layout hands them to the shared
 * `Sidebar` card (`_chrome/sidebar.tsx`) through the record routes' pieces
 * (`_chrome/record-sidebar.tsx`).
 *
 * ## The find field filters the list it sits above
 *
 * The mockup's field has no behaviour; here it narrows the groups below it
 * by name, counted heading or bound set text (`matchesFind`), and nothing
 * else - the grid has its own `All locations ▾` filter.
 *
 * ## Which row is lit
 *
 * The drawer is `/locations/:id`, so the selected record is the URL and
 * `useSelectedLayoutSegment` reads it from under the route's layout - no
 * cell to publish, and the first paint agrees with the page.
 */

/** What a sidebar row prints: the row minus the scene list and the rest the list never reads. */
export type LocationSidebarRow = Pick<LocationRow, 'id' | 'name' | 'ie' | 'status' | 'kind' | 'parentId' | 'depth' | 'rollup' | 'sluglines' | 'boundSluglines'>

export const sidebarRowOf = (row: LocationRow): LocationSidebarRow => ({
  id: row.id,
  name: row.name,
  ie: row.ie,
  status: row.status,
  kind: row.kind,
  parentId: row.parentId,
  depth: row.depth,
  rollup: row.rollup,
  sluglines: row.sluglines,
  boundSluglines: row.boundSluglines,
})

export const LocationTitleRow = ({ title }: { readonly title: string }) => (
  <RecordTitleRow
    title={title}
    action="New location"
    attr="data-sidebar-new-location"
    onAction={() => {
      setNewLocationOpen(true)
    }}
  />
)

export const LocationFind = () => <FindField placeholder="Find a location or slugline" testId="location-find" />

export const LocationGroups = ({ projectId, rows }: { readonly projectId: ProjectId; readonly rows: readonly LocationSidebarRow[] }) => {
  const { query } = useFind()
  const selected = useSelectedLayoutSegment()
  const groups = grouped(rows)
    .map((group) => ({ ...group, rows: group.rows.filter((row) => matchesFind(row, query)) }))
    .filter((group) => group.rows.length > 0)

  if (rows.length === 0) {
    return <SidebarNote attr="data-locations-empty">Locations appear here as the script names them. Nothing to list yet.</SidebarNote>
  }
  if (groups.length === 0) {
    return <SidebarNote attr="data-locations-no-match">No location matches that.</SidebarNote>
  }
  return (
    <div className="flex flex-col gap-[16px]" data-location-groups>
      {groups.map(({ group, rows: items }) => (
        <RecordGroup key={group} label={LOCATION_GROUP_LABELS[group]} total={items.length} attr={{ 'data-location-group': group }}>
          {items.map((row) => (
            <li key={row.id}>
              <Link
                href={locationHref(projectId, row.id)}
                data-location-row={row.id}
                aria-current={row.id === selected ? 'page' : undefined}
                className="folio-cast-row"
                style={row.depth > 0 ? { paddingLeft: 10 + row.depth * 12 } : undefined}
              >
                <span className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full" data-tone={statusTone(row.status)} />
                <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="truncate text-13">{row.name}</span>
                  <span className="truncate font-mono text-10-5 text-ink3">{row.ie ?? '—'}</span>
                </span>
                <span className="tabular flex-none text-11 text-ink3">{count(row.rollup.scenes)}</span>
              </Link>
            </li>
          ))}
        </RecordGroup>
      ))}
    </div>
  )
}

/** The `Scouted N / M` widget pinned at the foot. */
export const ScoutedWidget = ({ rows }: { readonly rows: readonly { readonly status: LocationStatus }[] }) => {
  const scouted = scoutedOf(rows)
  return <ProgressWidget label="Scouted" done={scouted.scouted} total={scouted.total} percent={scouted.percent} note={scouted.note} attr="scouted" />
}
