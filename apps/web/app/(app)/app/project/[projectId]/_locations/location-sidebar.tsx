'use client'

import type { LocationStatus, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useRouter, useSelectedLayoutSegment } from 'next/navigation'

import { setNewLocationOpen, setQueueIntent } from '../../../../../../lib/locations/compose'
import type { LocationSidebarRow } from '../../../../../../lib/locations/view'
import { LOCATION_GROUP_LABELS, grouped, matchesFind, scoutedLine, sidebarLine, statusTone } from '../../../../../../lib/locations/view'
import { count } from '../../../../../../lib/workspace/format'
import { locationHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import { FindField, useFind } from '../_chrome/find-field'
import { CountsWidget, RecordGroup, RecordTitleRow, SidebarNote } from '../_chrome/record-sidebar'
import { useLocationsView } from './view-state'

/**
 * The Locations sidebar's four slots, on the record routes' shared pieces
 * (`_chrome/record-sidebar.tsx`): the project's name with `+` (`New
 * location`), the recessed `Find a location or slugline` field, the grouped
 * list, and the foot widget.
 *
 * ## Groups
 *
 * `Needs a decision` first while the queue has rows - an amber dot, the set
 * text in mono, `N headings`; a click unfolds the queue on the Places view
 * (`setQueueIntent`). Then `Primary set` (each with its sub-sets indented
 * one step under it, so the tree reads in a flat list) · `Recurring` ·
 * `One-off` · `Not on the page yet`. A row: the status dot, the name over
 * `INT · 4 D · 5 N` (the interior / exterior word and the day / night
 * split - what a schedule reads, where the v2 pass printed `INT` alone),
 * and the roll-up's scene count in mono.
 *
 * ## The find field filters the list it sits above, and the body
 *
 * The field narrows the groups below it by name, counted heading or bound
 * set text (`matchesFind`) - and, since the rebuild, the grid, the scene
 * list and the sheet too (the workspace reads the same `useFind`).
 *
 * ## Which row is lit
 *
 * The drawer is `/locations/:id`, so the selected record is the URL and
 * `useSelectedLayoutSegment` reads it from under the route's layout - no
 * cell to publish, and the first paint agrees with the page.
 */

/** An open slugline as the sidebar lists it. */
export type LocationSidebarDecision = {
  readonly key: string
  readonly slugline: string
  readonly occurrences: number
}

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

const headingsLabel = (n: number): string => (n === 1 ? '1 heading' : `${String(n)} headings`)

export const LocationGroups = ({
  projectId,
  rows,
  decisions,
}: {
  readonly projectId: ProjectId
  readonly rows: readonly LocationSidebarRow[]
  readonly decisions: readonly LocationSidebarDecision[]
}) => {
  const { query } = useFind()
  const selected = useSelectedLayoutSegment()
  const router = useRouter()
  const { setView } = useLocationsView()
  const groups = grouped(rows)
    .map((group) => ({ ...group, rows: group.rows.filter((row) => matchesFind(row, query)) }))
    .filter((group) => group.rows.length > 0)
  const needle = query.trim().toLowerCase()
  const open = decisions.filter((decision) => needle === '' || decision.slugline.toLowerCase().includes(needle))

  if (rows.length === 0 && decisions.length === 0) {
    return <SidebarNote attr="data-locations-empty">Locations appear here as the script names them. Nothing to list yet.</SidebarNote>
  }
  if (groups.length === 0 && open.length === 0) {
    return <SidebarNote attr="data-locations-no-match">No location matches that.</SidebarNote>
  }

  const openQueue = (): void => {
    setQueueIntent('rows')
    setView('places')
    if (selected !== null) router.push(projectRouteHref(projectId, 'locations'))
  }

  return (
    <div className="flex flex-col gap-[16px]" data-location-groups>
      {open.length === 0 ? null : (
        <RecordGroup label="Needs a decision" total={open.length} attr={{ 'data-location-group': 'decisions' }}>
          {open.map((decision) => (
            <li key={decision.key}>
              <button type="button" data-decision-row={decision.key} onClick={openQueue} className="folio-record-row w-full text-left">
                <span className="h-[6px] w-[6px] flex-none rounded-full bg-warn" />
                <span className="min-w-0 flex-1 truncate font-mono text-12 uppercase text-ink">{decision.slugline}</span>
                <span className="tabular flex-none text-11 text-ink3">{headingsLabel(decision.occurrences)}</span>
              </button>
            </li>
          ))}
        </RecordGroup>
      )}
      {groups.map(({ group, rows: items }) => (
        <RecordGroup key={group} label={LOCATION_GROUP_LABELS[group]} total={items.length} attr={{ 'data-location-group': group }}>
          {items.map((row) => (
            <li key={row.id}>
              <Link
                href={locationHref(projectId, row.id)}
                data-location-row={row.id}
                aria-current={row.id === selected ? 'page' : undefined}
                className="folio-record-row"
                style={row.depth > 0 ? { paddingLeft: 10 + row.depth * 12 } : undefined}
              >
                <span className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full" data-tone={statusTone(row.status)} />
                <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="truncate text-13">{row.name}</span>
                  <span className="truncate font-mono text-10-5 text-ink3" data-row-line>
                    {sidebarLine(row)}
                  </span>
                </span>
                <span className="tabular flex-none font-mono text-11 text-ink3">{count(row.rollup.scenes)} sc</span>
              </Link>
            </li>
          ))}
        </RecordGroup>
      ))}
    </div>
  )
}

/** The foot widget: `Needs a decision · N` (a button that unfolds the queue) over `Scouted · 4 of 6`. */
export const LocationFootWidget = ({
  projectId,
  rows,
  decisions,
}: {
  readonly projectId: ProjectId
  readonly rows: readonly { readonly status: LocationStatus }[]
  readonly decisions: number
}) => {
  const router = useRouter()
  const selected = useSelectedLayoutSegment()
  const { setView } = useLocationsView()
  return (
    <CountsWidget
      attr="locations"
      rows={[
        {
          label: 'Needs a decision',
          value: String(decisions),
          attr: 'data-decisions-total',
          ...(decisions > 0
            ? {
                tone: 'warn' as const,
                onClick: () => {
                  setQueueIntent('rows')
                  setView('places')
                  if (selected !== null) router.push(projectRouteHref(projectId, 'locations'))
                },
              }
            : {}),
        },
        { label: 'Scouted', value: scoutedLine(rows), attr: 'data-scouted-count' },
      ]}
    />
  )
}
