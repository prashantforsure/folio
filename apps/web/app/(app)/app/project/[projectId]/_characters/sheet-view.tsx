'use client'

import type { ProjectId, SceneFacts, SceneRef } from '@folio/contracts'
import { CHARACTER_STATUS_LABELS } from '@folio/contracts'
import { EpisodeBars, Icon, PresenceStrip } from '@folio/ui'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { CastFigure } from '../../../../../../lib/characters/cast'
import { balanceOf, fitsStrip, statusTone, stripGroups } from '../../../../../../lib/characters/cast'
import { citeOf } from '../../../../../../lib/characters/figures'
import type { SortDirection, SortKey } from '../../../../../../lib/characters/sheet'
import { csvOf, defaultDirection, eighthsOf, introRefOf, scopeOf, sortFigures } from '../../../../../../lib/characters/sheet'
import { ABSENT, episodeLabel, eighths, thousands } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { CitationChips } from '../_chrome/citation-chips'
import { FilterMenu } from '../_chrome/record-toolbar'
import type { EpisodeRow } from './characters-workspace'

/**
 * The Sheet view: a real table. A head row with `All episodes ▾` (the
 * counts, the share and the span scoped to one episode) and `Export CSV`;
 * then the table on `--s1` - a sticky eyebrow header on `--sunk` whose
 * cells are sortable (`aria-sort`, a chevron on the active key; speaks
 * descending by default, names ascending), a row per record as a link, the
 * status as a 6px dot beside the name, mono counts, the share as a 40×4
 * bar and a percentage, the per-episode scene counts, the presence strip,
 * the introducing scene, the eighths, the span as citation chips into the
 * script, and a totals row. Under it the `Balance` card: per episode, who
 * speaks most and how much of the dialogue that is.
 *
 * Sort and scope are component state, like the toolbar's filter - the URL
 * stays `/characters`. The CSV is the rows as shown, built in the browser;
 * nothing leaves the app that is not on screen. `First` / `Last` / `Intro`
 * / `Eighths` print `—` for a record with nothing there, the "exists or
 * doesn't" convention (AGENTS.md, UI fidelity).
 */
type Scope = 'all' | `ep:${string}`

const COLUMNS: readonly { readonly key: SortKey; readonly label: string; readonly width: string; readonly align: 'left' | 'right' }[] = [
  { key: 'role', label: 'Role', width: 'w-[140px]', align: 'left' },
  { key: 'speaks', label: 'Speaks', width: 'w-[64px]', align: 'right' },
  { key: 'mentioned', label: 'Mentioned', width: 'w-[80px]', align: 'right' },
  { key: 'lines', label: 'Lines', width: 'w-[56px]', align: 'right' },
  { key: 'words', label: 'Words', width: 'w-[64px]', align: 'right' },
  { key: 'share', label: 'Share', width: 'w-[92px]', align: 'left' },
]

export const SheetView = ({
  projectId,
  shape,
  shown,
  index,
  episodes,
  selectedId,
  onShowAll,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly shown: readonly CastFigure[]
  readonly index: readonly SceneFacts[]
  readonly episodes: readonly EpisodeRow[]
  readonly selectedId: string | null
  readonly onShowAll: () => void
}) => {
  const [sort, setSort] = useState<{ readonly key: SortKey; readonly direction: SortDirection }>({ key: 'speaks', direction: 'desc' })
  const [scope, setScope] = useState<Scope>('all')
  const ordinal = scope === 'all' ? null : Number(scope.slice(3))
  const scoped = ordinal !== null
  const episodeOrdinals = useMemo(() => episodes.map((episode) => episode.ordinal), [episodes])
  const episodeColumns = scoped ? [] : episodeOrdinals
  const rows = useMemo(() => sortFigures(shown, sort.key, sort.direction), [shown, sort])
  const scopedIndex = useMemo(() => (ordinal === null ? index : index.filter((scene) => scene.episodeOrdinal === ordinal)), [index, ordinal])
  const balance = useMemo(() => balanceOf(shown, index, episodeOrdinals).filter((row) => row.total > 0 || row.voices > 0), [episodeOrdinals, index, shown])

  const pick = (key: SortKey): void => {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: defaultDirection(key) },
    )
  }
  const sortAttr = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'

  const exportCsv = (): void => {
    const csv = csvOf(rows, scoped ? [ordinal] : episodeOrdinals)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'cast.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const totals = rows.reduce(
    (sum, figure) => {
      const in_ = scopeOf(figure, ordinal, index, episodeOrdinals)
      return {
        speaks: sum.speaks + in_.speaks,
        mentioned: sum.mentioned + in_.mentioned,
        lines: sum.lines + figure.lines,
        words: sum.words + in_.words,
        perEpisode: sum.perEpisode.map((total, at) => total + (figure.perEpisode[at] ?? 0)),
      }
    },
    { speaks: 0, mentioned: 0, lines: 0, words: 0, perEpisode: episodes.map(() => 0) },
  )

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

  const chip = (ref: SceneRef | null) =>
    ref === null ? <span className="font-mono text-11-5 text-ink3">{ABSENT}</span> : <CitationChips refs={[citeOf(projectId, shape, ref)]} />

  return (
    <div data-sheet-view className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-auto px-[20px] pb-[20px]">
      <div className="flex flex-none items-center gap-[10px]">
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
      <div role="table" aria-label="Cast" className="min-w-[1040px] flex-none overflow-hidden rounded-card border border-line2 bg-s1">
        <div role="row" className="sticky top-0 z-[4] flex items-center gap-[12px] border-b border-line2 bg-sunk px-[16px] py-[11px]">
          {head('name', 'Name', 'min-w-0 flex-1')}
          {COLUMNS.map((column) => head(column.key, column.key === 'lines' && scoped ? 'Lines · all' : column.label, column.width, column.align))}
          {episodeColumns.map((n) => head(`e${String(n)}` as SortKey, `E${String(n)}`, 'w-[40px]', 'right'))}
          <span role="columnheader" className="folio-eyebrow w-[160px] flex-none">
            Presence
          </span>
          {head('intro', 'Intro', 'w-[72px]')}
          {head('eighths', 'Eighths', 'w-[60px]', 'right')}
          {head('first', 'First', 'w-[76px]')}
          {head('last', 'Last', 'w-[76px]')}
        </div>
        {rows.length === 0 ? (
          <p className="m-0 px-[16px] py-[14px] text-12-5 text-ink3" data-sheet-empty>
            No character matches that filter.{' '}
            <button type="button" data-show-all onClick={onShowAll} className="text-accent hover:underline">
              Show all
            </button>
          </p>
        ) : (
          <>
            {rows.map((figure) => {
              const in_ = scopeOf(figure, ordinal, index, episodeOrdinals)
              const strip = ordinal === null ? figure.strip : scopedIndex.map((scene) => (scene.speaking.includes(figure.id) ? 'speaks' : scene.mentioned.includes(figure.id) ? 'mentioned' : 'absent'))
              const measured = eighthsOf(figure)
              return (
                <Link
                  key={figure.id}
                  role="row"
                  href={characterHref(projectId, figure.id)}
                  data-sheet-row={figure.id}
                  aria-current={figure.id === selectedId ? 'true' : undefined}
                  className="folio-sheet-row"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-[10px]">
                    <span
                      className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full"
                      data-tone={statusTone(figure.status)}
                      data-sheet-status={figure.status}
                      title={CHARACTER_STATUS_LABELS[figure.status]}
                    />
                    <span className="min-w-0 flex-1 truncate text-13">{figure.name}</span>
                  </span>
                  <span className="w-[140px] flex-none truncate text-12-5 text-ink2">{figure.role ?? ABSENT}</span>
                  <span className="tabular w-[64px] flex-none text-right font-mono text-12 text-ink2" data-sheet-speaks>
                    {in_.speaks}
                  </span>
                  <span className="tabular w-[80px] flex-none text-right font-mono text-12 text-ink2">{in_.mentioned}</span>
                  <span className="tabular w-[56px] flex-none text-right font-mono text-12 text-ink2">{figure.lines}</span>
                  <span className="tabular w-[64px] flex-none text-right font-mono text-12 text-ink2" data-sheet-words>
                    {thousands(in_.words)}
                  </span>
                  <span className="flex w-[92px] flex-none items-center gap-[6px]" data-sheet-share={in_.share}>
                    <span className="folio-share-bar">
                      <span style={{ width: `${String(in_.share)}%` }} />
                    </span>
                    <span className="tabular font-mono text-11 text-ink3">{in_.share}%</span>
                  </span>
                  {episodeColumns.map((n) => (
                    <span key={n} className="tabular w-[40px] flex-none text-right font-mono text-12 text-ink3">
                      {figure.perEpisode[n - 1] ?? 0}
                    </span>
                  ))}
                  <span className="flex w-[160px] flex-none items-center" data-sheet-strip>
                    {figure.presence === 'absent' ? (
                      <span className="font-mono text-11-5 text-ink3">{ABSENT}</span>
                    ) : fitsStrip('sheet', scopedIndex.length) ? (
                      <PresenceStrip groups={stripGroups(strip, scopedIndex)} size="sheet" />
                    ) : (
                      <EpisodeBars counts={figure.perEpisode} />
                    )}
                  </span>
                  <span className="w-[72px] flex-none" data-sheet-intro>
                    {chip(introRefOf(figure) === null ? null : (figure.refs.find((ref) => ref.sceneNodeId === introRefOf(figure)?.sceneNodeId) ?? null))}
                  </span>
                  <span className="tabular w-[60px] flex-none text-right font-mono text-12 text-ink2" data-sheet-eighths>
                    {measured === null ? ABSENT : eighths(measured)}
                  </span>
                  <span className="w-[76px] flex-none">{chip(in_.first)}</span>
                  <span className="w-[76px] flex-none">{chip(in_.last)}</span>
                </Link>
              )
            })}
            <div role="row" data-sheet-totals className="flex items-center gap-[12px] px-[16px] py-[10px] font-mono text-11 text-ink3">
              <span className="tabular min-w-0 flex-1">
                {rows.length} {rows.length === 1 ? 'character' : 'characters'}
              </span>
              <span className="w-[140px] flex-none" />
              <span className="tabular w-[64px] flex-none text-right">{totals.speaks}</span>
              <span className="tabular w-[80px] flex-none text-right">{totals.mentioned}</span>
              <span className="tabular w-[56px] flex-none text-right">{totals.lines}</span>
              <span className="tabular w-[64px] flex-none text-right">{thousands(totals.words)}</span>
              <span className="w-[92px] flex-none" />
              {episodeColumns.map((n) => (
                <span key={n} className="tabular w-[40px] flex-none text-right">
                  {totals.perEpisode[n - 1] ?? 0}
                </span>
              ))}
              <span className="w-[160px] flex-none" />
              <span className="w-[72px] flex-none">{ABSENT}</span>
              <span className="w-[60px] flex-none text-right">{ABSENT}</span>
              <span className="w-[76px] flex-none">{ABSENT}</span>
              <span className="w-[76px] flex-none">{ABSENT}</span>
            </div>
          </>
        )}
      </div>
      {balance.length === 0 ? null : (
        <div className="folio-balance-card flex-none" data-balance>
          <div className="flex items-baseline gap-[8px]">
            <span className="folio-eyebrow flex-1">Balance</span>
            <span className="text-11 text-ink3">who carries each episode</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
            {balance.map((row) => (
              <li key={row.ordinal} data-balance-episode={row.ordinal} className="flex flex-wrap items-baseline gap-x-[8px] text-12">
                <span className="tabular w-[28px] flex-none font-mono text-10-5 text-ink3">E{row.ordinal}</span>
                {row.lead === null ? (
                  <span className="text-ink3">no dialogue yet</span>
                ) : (
                  <span className="text-ink2">
                    <Link href={characterHref(projectId, row.lead.id)} className="text-ink no-underline hover:text-accent hover:no-underline">
                      {row.lead.name}
                    </Link>{' '}
                    {row.lead.share}% of {thousands(row.total)} words · {row.voices} {row.voices === 1 ? 'voice' : 'voices'}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <span className="text-11 text-ink3">counted from the script · no verdict</span>
        </div>
      )}
    </div>
  )
}
