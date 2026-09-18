'use client'

import type { LocationRow, ProjectId } from '@folio/contracts'
import { LOCATION_STATUS_LABELS } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import { citeOf } from '../../../../../../lib/characters/figures'
import type { SortDirection, SortKey } from '../../../../../../lib/locations/sheet'
import { csvOf, defaultDirection, scopeOf, sortRows, totalsOf } from '../../../../../../lib/locations/sheet'
import { kindLabel, statusTone } from '../../../../../../lib/locations/view'
import { ABSENT, eighths, episodeLabel } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import { FilterMenu } from '../_chrome/record-toolbar'
import type { EpisodeRow } from './locations-workspace'
import { SetMark } from './set-parts'

/**
 * The Sheet view - a real table since the rebuild (2026-09-18): a head row
 * with `All episodes ▾` (every count scoped to one episode) and `Export
 * CSV`; then the table on `--s1` - a sticky eyebrow header on `--sunk`
 * whose cells are sortable (`aria-sort`, a chevron on the active key;
 * scenes descending by default, names ascending), a row per record as a
 * link (middle-click opens a tab), indented one step per depth, the status
 * as a 6px dot beside the name, the kind, mono counts, `INT/EXT`, the day
 * and night columns, the pages, the shooting days (the roll-up), the
 * per-episode counts, the span as citation chips into the script, and a
 * totals row over the primary sets.
 *
 * Sort and scope are component state, like the toolbar's filter - the URL
 * stays `/locations`. `Days` is a scheduling fact, not per episode, and
 * its header says so when scoped (`Days · all`). The CSV is the rows as
 * shown, built in the browser; nothing leaves the app that is not on
 * screen. `Pages`, `First` and `Last` print `—` for a record with no
 * scene or no measurement, the "exists or doesn't" convention (AGENTS.md,
 * UI fidelity); `Scenes` prints `0`, a count that legitimately is one.
 */
type Scope = 'all' | `ep:${string}`

export const SheetView = ({
  projectId,
  shape,
  shown,
  episodes,
  selectedId,
  onShowAll,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly shown: readonly LocationRow[]
  readonly episodes: readonly EpisodeRow[]
  readonly selectedId: string | null
  readonly onShowAll: () => void
}) => {
  const [sort, setSort] = useState<{ readonly key: SortKey; readonly direction: SortDirection }>({ key: 'scenes', direction: 'desc' })
  const [scope, setScope] = useState<Scope>('all')
  const ordinal = scope === 'all' ? null : Number(scope.slice(3))
  const scoped = ordinal !== null
  const episodeColumns = scoped || episodes.length < 2 ? [] : episodes.map((episode) => episode.ordinal)
  const rows = useMemo(() => sortRows(shown, sort.key, sort.direction, ordinal), [shown, sort, ordinal])
  const totals = useMemo(() => totalsOf(rows, ordinal, episodeColumns), [rows, ordinal, episodeColumns])

  const pick = (key: SortKey): void => {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: defaultDirection(key) },
    )
  }
  const sortAttr = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'

  const exportCsv = (): void => {
    const csv = csvOf(rows, ordinal, scoped ? [ordinal] : episodes.map((episode) => episode.ordinal))
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'locations.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const head = (sortKey: SortKey, label: string, width: string, align: 'left' | 'right' = 'left') => (
    <button
      key={sortKey}
      type="button"
      role="columnheader"
      aria-sort={sortAttr(sortKey)}
      data-sort={sortKey}
      onClick={() => {
        pick(sortKey)
      }}
      className={`folio-eyebrow flex ${width} flex-none items-center gap-[4px] bg-transparent p-0 text-left ${align === 'right' ? 'justify-end' : ''} ${sort.key === sortKey ? 'text-ink' : 'hover:text-ink2'}`}
    >
      <span className="truncate">{label}</span>
      {sort.key === sortKey ? (
        <Icon name="chevron" size={9} strokeWidth={1.6} className={`flex-none ${sort.direction === 'asc' ? 'rotate-180' : ''}`} />
      ) : null}
    </button>
  )

  const mono = 'tabular flex-none text-right font-mono text-12 text-ink2'

  return (
    <div data-sheet-view className="flex min-h-0 flex-1 flex-col overflow-auto px-[20px] pb-[20px]">
      <div className="flex flex-none items-center gap-[10px] pb-[10px]">
        {episodes.length < 2 ? null : (
          <FilterMenu
            value={scope}
            options={['all' as Scope, ...episodes.map((episode): Scope => `ep:${String(episode.ordinal)}`)]}
            label={(option) => {
              if (option === 'all') return 'All episodes'
              const episode = episodes.find((entry) => `ep:${String(entry.ordinal)}` === option)
              return episode === undefined ? option : episodeLabel(episode.ordinal, episode.title)
            }}
            attr="data-sheet-scope"
            onPick={setScope}
          />
        )}
        <div className="flex-1" />
        <button
          type="button"
          data-sheet-export
          disabled={rows.length === 0}
          onClick={exportCsv}
          className="folio-line-button flex h-[30px] items-center gap-[7px] rounded-[9px] px-[11px] text-12"
        >
          <Icon name="export" size={13} strokeWidth={1.4} />
          Export CSV
        </button>
      </div>
      <div role="table" aria-label="Locations" className="min-w-[1040px] overflow-hidden rounded-card border border-line2 bg-s1">
        <div role="row" className="sticky top-0 z-[4] flex items-center gap-[12px] border-b border-line2 bg-sunk px-[16px] py-[11px]">
          {head('name', 'Location', 'min-w-0 flex-1')}
          {head('kind', 'Type', 'w-[150px]')}
          {head('status', 'Status', 'w-[80px]')}
          {head('scenes', 'Scenes', 'w-[58px]', 'right')}
          {head('ie', 'Int/Ext', 'w-[60px]')}
          {head('day', 'Day', 'w-[44px]', 'right')}
          {head('night', 'Night', 'w-[48px]', 'right')}
          {head('pages', 'Pages', 'w-[64px]', 'right')}
          {head('days', scoped ? 'Days · all' : 'Days', 'w-[68px]', 'right')}
          {head('cast', 'Cast', 'w-[44px]', 'right')}
          {episodeColumns.map((n) => head(`e${n}` as SortKey, `E${String(n)}`, 'w-[40px]', 'right'))}
          {head('first', 'First', 'w-[76px]')}
          {head('last', 'Last', 'w-[76px]')}
        </div>
        {rows.length === 0 ? (
          <p className="m-0 px-[16px] py-[14px] text-12-5 text-ink3" data-sheet-empty>
            No location matches that filter.{' '}
            <button type="button" data-show-all onClick={onShowAll} className="text-accent hover:underline">
              Show all
            </button>
          </p>
        ) : (
          <>
            {rows.map((row) => {
              const in_ = scopeOf(row, ordinal)
              return (
                <Link
                  key={row.id}
                  role="row"
                  href={locationHref(projectId, row.id)}
                  data-sheet-row={row.id}
                  aria-current={row.id === selectedId ? 'true' : undefined}
                  className="folio-sheet-row"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-[10px]" style={{ paddingLeft: row.depth * 14 }}>
                    <SetMark id={row.id} size={22} />
                    <span
                      className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full"
                      data-tone={statusTone(row.status)}
                      data-sheet-status={row.status}
                      title={LOCATION_STATUS_LABELS[row.status]}
                    />
                    <span className="min-w-0 flex-1 truncate text-13">{row.name}</span>
                  </span>
                  <span className="w-[150px] flex-none truncate text-12-5 text-ink2">{kindLabel(row)}</span>
                  <span className="w-[80px] flex-none truncate text-12 text-ink2">{LOCATION_STATUS_LABELS[row.status]}</span>
                  <span className={`w-[58px] ${mono}`} data-sheet-scenes>
                    {in_.scenes}
                  </span>
                  <span className="w-[60px] flex-none font-mono text-11-5 text-ink2">{row.ie ?? ABSENT}</span>
                  <span className={`w-[44px] ${mono}`}>{in_.day}</span>
                  <span className={`w-[48px] ${mono}`}>{in_.night}</span>
                  <span className="tabular w-[64px] flex-none text-right font-mono text-11-5 text-ink3">{eighths(in_.eighths)}</span>
                  <span className="tabular w-[68px] flex-none text-right font-mono text-11-5 text-ink3" data-sheet-days title={row.rollup.shootingDays === row.scheduledDays ? undefined : `${String(row.scheduledDays)} at this set; ${String(row.rollup.shootingDays)} with its sub-sets`}>
                    {row.rollup.shootingDays === 0 ? ABSENT : row.rollup.shootingDays}
                  </span>
                  <span className={`w-[44px] ${mono}`}>{row.people.length}</span>
                  {episodeColumns.map((n) => (
                    <span key={n} className="tabular w-[40px] flex-none text-right font-mono text-12 text-ink3">
                      {row.perEpisode[n - 1] ?? 0}
                    </span>
                  ))}
                  <span className="w-[76px] flex-none">
                    {in_.first === null ? <span className="font-mono text-11-5 text-ink3">{ABSENT}</span> : <CitationChips refs={[citeOf(projectId, shape, in_.first)]} />}
                  </span>
                  <span className="w-[76px] flex-none">
                    {in_.last === null ? <span className="font-mono text-11-5 text-ink3">{ABSENT}</span> : <CitationChips refs={[citeOf(projectId, shape, in_.last)]} />}
                  </span>
                </Link>
              )
            })}
            <div role="row" data-sheet-totals className="flex items-center gap-[12px] px-[16px] py-[10px] font-mono text-11 text-ink3">
              <span className="tabular min-w-0 flex-1">
                {rows.length} {rows.length === 1 ? 'location' : 'locations'} · totals over the primary sets
              </span>
              <span className="w-[150px] flex-none" />
              <span className="w-[80px] flex-none" />
              <span className="tabular w-[58px] flex-none text-right">{totals.scenes}</span>
              <span className="w-[60px] flex-none" />
              <span className="tabular w-[44px] flex-none text-right">{totals.day}</span>
              <span className="tabular w-[48px] flex-none text-right">{totals.night}</span>
              <span className="tabular w-[64px] flex-none text-right">{eighths(totals.eighths)}</span>
              <span className="tabular w-[68px] flex-none text-right">{totals.days === 0 ? ABSENT : totals.days}</span>
              <span className="w-[44px] flex-none" />
              {episodeColumns.map((n, index) => (
                <span key={n} className="tabular w-[40px] flex-none text-right">
                  {totals.perEpisode[index] ?? 0}
                </span>
              ))}
              <span className="w-[76px] flex-none">{ABSENT}</span>
              <span className="w-[76px] flex-none">{ABSENT}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
