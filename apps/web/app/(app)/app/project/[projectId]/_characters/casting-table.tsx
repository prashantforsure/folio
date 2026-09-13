'use client'

import type { CastRow, ProjectId } from '@folio/contracts'
import { CHARACTER_GENDER_LABELS } from '@folio/contracts'
import { Glyph } from '@folio/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { ABSENT } from '../../../../../../lib/workspace/format'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { PortraitTile } from './portrait-tile'

/**
 * The Casting view: one row per record - Name (chip, name, `N scenes`),
 * Gender, Age, Role/Identity, Scenes, Lines. Every column sorts on a
 * click of its header; `⚙ Display` shows or hides columns. Both are
 * component state: a sort and a column set are a way of looking, not a
 * sub-view. A row opens the drawer.
 *
 * Empty meta follows the convention: a count that is legitimately zero
 * prints `0`; a fact that is either set or not prints `—`.
 */

type Column = 'gender' | 'age' | 'role' | 'scenes' | 'lines'

type SortKey = 'name' | Column

const COLUMNS: readonly { readonly id: Column; readonly label: string; readonly width: string; readonly numeric: boolean }[] = [
  { id: 'gender', label: 'Gender', width: '110px', numeric: false },
  { id: 'age', label: 'Age', width: '80px', numeric: false },
  { id: 'role', label: 'Role/Identity', width: 'minmax(140px, 1.2fr)', numeric: false },
  { id: 'scenes', label: 'Scenes', width: '80px', numeric: true },
  { id: 'lines', label: 'Lines', width: '80px', numeric: true },
]

const valueOf = (row: CastRow, key: SortKey): string | number => {
  switch (key) {
    case 'name':
      return row.name
    case 'gender':
      return row.gender === null ? '' : CHARACTER_GENDER_LABELS[row.gender]
    case 'age':
      return row.age === null ? '' : /^\d+$/.test(row.age) ? Number(row.age) : row.age
    case 'role':
      return row.role ?? ''
    case 'scenes':
      return row.appearances
    case 'lines':
      return row.lines
  }
}

export const CastingTable = ({
  projectId,
  cast,
  query,
}: {
  readonly projectId: ProjectId
  readonly cast: readonly CastRow[]
  readonly query: string
}) => {
  const router = useRouter()
  const [sort, setSort] = useState<{ readonly key: SortKey; readonly dir: 1 | -1 }>({ key: 'scenes', dir: -1 })
  const [shown, setShown] = useState<ReadonlySet<Column>>(() => new Set(COLUMNS.map((column) => column.id)))
  const [display, setDisplay] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!display) return
    const close = (event: MouseEvent): void => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) setDisplay(false)
    }
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('mousedown', close)
    }
  }, [display])

  const needle = query.trim().toLowerCase()
  const rows = cast
    .filter((row) => needle === '' || row.name.toLowerCase().includes(needle) || (row.role ?? '').toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => {
      const x = valueOf(a, sort.key)
      const y = valueOf(b, sort.key)
      const order =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })
      return order * sort.dir || a.name.localeCompare(b.name)
    })

  const visible = COLUMNS.filter((column) => shown.has(column.id))
  const template = `minmax(220px, 2fr) ${visible.map((column) => column.width).join(' ')}`

  const toggleSort = (key: SortKey): void => {
    setSort((state) => (state.key === key ? { key, dir: state.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }))
  }

  const Header = ({ id, label, numeric }: { readonly id: SortKey; readonly label: string; readonly numeric: boolean }) => (
    <button
      type="button"
      onClick={() => {
        toggleSort(id)
      }}
      aria-sort={sort.key === id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      data-sort={id}
      className={`flex items-center gap-[4px] border-none bg-transparent px-0 py-0 text-11 font-semibold text-ink2 hover:text-ink ${numeric ? 'justify-end' : ''}`}
    >
      {label}
      <span aria-hidden="true" className="text-9 text-ink3">
        {sort.key === id ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}
      </span>
    </button>
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden" data-casting-table>
      <div className="flex items-center justify-end px-[24px] pb-[8px] pt-[12px]">
        <div ref={menu} className="relative">
          <button
            type="button"
            aria-expanded={display}
            data-display-menu
            onClick={() => {
              setDisplay((state) => !state)
            }}
            className="flex items-center gap-[6px] rounded-chrome border border-line2 bg-panel px-[10px] py-[5px] text-11-5 text-ink2 hover:bg-hover hover:text-ink"
          >
            <Glyph name="settings" className="text-11" />
            Display
          </button>
          {display ? (
            <div className="absolute right-0 top-[30px] z-20 flex w-[180px] flex-col gap-[2px] rounded-card border border-line bg-panel p-[6px] shadow-[0_8px_24px_var(--scrim)]">
              {COLUMNS.map((column) => (
                <label key={column.id} className="flex items-center gap-[8px] rounded-chrome px-[8px] py-[5px] text-11-5 text-ink2 hover:bg-hover">
                  <input
                    type="checkbox"
                    checked={shown.has(column.id)}
                    onChange={(event) => {
                      setShown((state) => {
                        const next = new Set(state)
                        if (event.target.checked) next.add(column.id)
                        else next.delete(column.id)
                        return next
                      })
                    }}
                  />
                  {column.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-[24px] pb-[60px]">
        <div className="min-w-[640px] overflow-hidden rounded-card border border-line bg-panel">
          <div className="grid items-center gap-[12px] border-b border-line px-[14px] py-[9px]" style={{ gridTemplateColumns: template }}>
            <Header id="name" label="Name" numeric={false} />
            {visible.map((column) => (
              <Header key={column.id} id={column.id} label={column.label} numeric={column.numeric} />
            ))}
          </div>
          {rows.length === 0 ? (
            <div className="px-[14px] py-[16px] text-12 text-ink3">Nobody matches “{query.trim()}”.</div>
          ) : null}
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              data-casting-row={row.id}
              onClick={() => {
                router.push(characterHref(projectId, row.id))
              }}
              className="grid w-full items-center gap-[12px] border-b border-line2 bg-transparent px-[14px] py-[10px] text-left text-12 text-ink hover:bg-hover"
              style={{ gridTemplateColumns: template }}
            >
              <span className="flex min-w-0 items-center gap-[10px]">
                <PortraitTile hue={row.hue} portraitUrl={row.portraitUrl} name={row.name} glyphSize={18} className="h-[34px] w-[34px] flex-none rounded-[7px]" />
                <span className="truncate font-semibold">{row.name}</span>
                <span className="tabular flex-none text-10-5 text-ink3">
                  {row.appearances} {row.appearances === 1 ? 'scene' : 'scenes'}
                </span>
              </span>
              {visible.map((column) => (
                <span key={column.id} className={`truncate ${column.numeric ? 'tabular text-right' : ''} ${column.id === 'role' ? 'text-ink2' : ''}`}>
                  {column.id === 'gender'
                    ? row.gender === null
                      ? ABSENT
                      : CHARACTER_GENDER_LABELS[row.gender]
                    : column.id === 'age'
                      ? (row.age ?? ABSENT)
                      : column.id === 'role'
                        ? (row.role ?? ABSENT)
                        : column.id === 'scenes'
                          ? row.appearances
                          : row.lines}
                </span>
              ))}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
