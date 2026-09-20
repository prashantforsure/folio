'use client'

import { CHARACTER_GENDER_LABELS } from '@folio/contracts'
import type { ProjectId } from '@folio/contracts'
import { EpisodeBars, Icon, IdentityChip } from '@folio/ui'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { CastFigure } from '../../../../../../../lib/characters/cast'
import { csvOf, defaultDirection, sortCast } from '../../../../../../../lib/characters/list'
import type { ListSortKey, OptionalColumn, SortDirection } from '../../../../../../../lib/characters/list'
import { count, thousands } from '../../../../../../../lib/workspace/format'
import { characterHref } from '../../../../../../../lib/workspace/hrefs'
import { DisplayMenu } from './display-menu'

/**
 * The List view (2026-09-20): one row per character - Name (the chip, the
 * name, `N scenes` under it) · Gender · Age · Role · Scenes · Lines, every
 * column sortable (`lib/characters/list.ts`); the `Display` menu adds
 * Words, Share of dialogue (a bar) and Episodes (bars) and offers `Export
 * CSV`, which is built in the browser from the rows as shown. A row is a
 * link to the drawer (`/characters/:id`); `.folio-sheet-row` is shared
 * with Locations. Every number is the derivation's; `—` marks a field
 * nobody has set, `0` a count that is zero.
 */
const ABSENT = '—'

const COLUMNS: readonly { readonly key: Exclude<ListSortKey, `e${number}`>; readonly label: string; readonly width: string; readonly align: 'left' | 'right' }[] = [
  { key: 'gender', label: 'Gender', width: 'w-[96px]', align: 'left' },
  { key: 'age', label: 'Age', width: 'w-[64px]', align: 'left' },
  { key: 'role', label: 'Role', width: 'w-[180px]', align: 'left' },
  { key: 'scenes', label: 'Scenes', width: 'w-[64px]', align: 'right' },
  { key: 'lines', label: 'Lines', width: 'w-[56px]', align: 'right' },
]

export const ListView = ({
  projectId,
  figures,
  episodeOrdinals,
  selectedId,
}: {
  readonly projectId: ProjectId
  readonly figures: readonly CastFigure[]
  readonly episodeOrdinals: readonly number[]
  readonly selectedId: string | null
}) => {
  const [sort, setSort] = useState<{ readonly key: ListSortKey; readonly direction: SortDirection }>({ key: 'scenes', direction: 'desc' })
  const [shown, setShown] = useState<ReadonlySet<OptionalColumn>>(new Set())
  const rows = useMemo(() => sortCast(figures, sort.key, sort.direction), [figures, sort])
  const words = shown.has('words')
  const share = shown.has('share')
  const episodes = shown.has('episodes')

  const pick = (key: ListSortKey): void => {
    setSort((current) => (current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: defaultDirection(key) }))
  }
  const sortAttr = (key: ListSortKey): 'ascending' | 'descending' | 'none' => (sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none')

  const exportCsv = (): void => {
    const csv = csvOf(rows, { words, share, episodes: episodes ? episodeOrdinals : null })
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'characters.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const head = (key: ListSortKey, label: string, width: string, align: 'left' | 'right' = 'left') => (
    <button
      key={key}
      type="button"
      role="columnheader"
      aria-sort={sortAttr(key)}
      data-sort={key}
      onClick={() => {
        pick(key)
      }}
      className={`folio-eyebrow flex ${width} flex-none items-center gap-[4px] bg-transparent p-0 text-left ${align === 'right' ? 'justify-end' : ''} ${sort.key === key ? 'text-ink' : 'hover:text-ink2'}`}
    >
      <span className="truncate">{label}</span>
      {sort.key === key ? <Icon name="chevron" size={9} strokeWidth={1.6} className={`flex-none ${sort.direction === 'asc' ? 'rotate-180' : ''}`} /> : null}
    </button>
  )

  const text = (value: string | null, attr: string) => (
    <span className={`min-w-0 truncate text-12-5 ${value === null ? 'font-mono text-ink3' : 'text-ink2'}`} {...{ [attr]: value ?? 'none' }}>
      {value ?? ABSENT}
    </span>
  )

  return (
    <div data-list-view className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-auto px-[20px] pb-[20px]">
      <div className="flex flex-none items-center gap-[10px]">
        <div className="flex-1" />
        <DisplayMenu
          shown={shown}
          canExport={rows.length > 0}
          onExport={exportCsv}
          onToggle={(column) => {
            setShown((current) => {
              const next = new Set(current)
              if (next.has(column)) next.delete(column)
              else next.add(column)
              return next
            })
          }}
        />
      </div>
      <div role="table" aria-label="Characters" className="min-w-[760px] flex-none overflow-hidden rounded-card border border-line2 bg-s1">
        <div role="row" className="sticky top-0 z-[4] flex items-center gap-[12px] border-b border-line2 bg-sunk px-[16px] py-[11px]">
          {head('name', 'Name', 'min-w-0 flex-1')}
          {COLUMNS.map((column) => head(column.key, column.label, column.width, column.align))}
          {words ? head('words', 'Words', 'w-[64px]', 'right') : null}
          {share ? head('share', 'Share of dialogue', 'w-[128px]') : null}
          {episodes ? (
            <span role="columnheader" className="folio-eyebrow w-[120px] flex-none" data-column-episodes>
              Episodes
            </span>
          ) : null}
        </div>
        {rows.map((figure) => (
          <Link key={figure.id} role="row" href={characterHref(projectId, figure.id)} data-list-row={figure.id} aria-current={figure.id === selectedId ? 'true' : undefined} className="folio-sheet-row">
            <span className="flex min-w-0 flex-1 items-center gap-[10px]">
              <IdentityChip initial={figure.initial} hue={figure.hue} size={22} shape="square" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-13" data-list-name>
                  {figure.name}
                </span>
                <span className="tabular text-10-5 text-ink3">
                  {count(figure.appearances)} {figure.appearances === 1 ? 'scene' : 'scenes'}
                </span>
              </span>
            </span>
            <span className="flex w-[96px] flex-none">{text(figure.gender === null ? null : CHARACTER_GENDER_LABELS[figure.gender], 'data-list-gender')}</span>
            <span className="flex w-[64px] flex-none">{text(figure.age === null || figure.age.trim() === '' ? null : figure.age, 'data-list-age')}</span>
            <span className="flex w-[180px] flex-none">{text(figure.role === null || figure.role.trim() === '' ? null : figure.role, 'data-list-role')}</span>
            <span className="tabular w-[64px] flex-none text-right font-mono text-12 text-ink2" data-list-scenes={figure.appearances}>
              {figure.appearances}
            </span>
            <span className="tabular w-[56px] flex-none text-right font-mono text-12 text-ink2" data-list-lines={figure.lines}>
              {figure.lines}
            </span>
            {words ? (
              <span className="tabular w-[64px] flex-none text-right font-mono text-12 text-ink2" data-list-words={figure.words}>
                {thousands(figure.words)}
              </span>
            ) : null}
            {share ? (
              <span className="flex w-[128px] flex-none items-center gap-[8px]" data-list-share={figure.share}>
                <span className="inline-block h-[4px] w-[40px] overflow-hidden rounded-[2px] bg-s3" aria-hidden>
                  <span className="block h-full rounded-[2px] bg-ink2" style={{ width: `${String(figure.share)}%` }} />
                </span>
                <span className="tabular font-mono text-11 text-ink2">{figure.share}%</span>
              </span>
            ) : null}
            {episodes ? (
              <span className="flex w-[120px] flex-none" data-list-episodes>
                <EpisodeBars counts={figure.episodeScenes} />
              </span>
            ) : null}
          </Link>
        ))}
        <div role="row" data-list-totals className="flex items-center gap-[12px] px-[16px] py-[10px] font-mono text-11 text-ink3">
          <span className="tabular min-w-0 flex-1">
            {rows.length} {rows.length === 1 ? 'character' : 'characters'}
          </span>
        </div>
      </div>
    </div>
  )
}
