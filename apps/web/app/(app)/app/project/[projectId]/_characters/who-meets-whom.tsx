'use client'

import type { CharacterMap, ProjectId } from '@folio/contracts'
import Link from 'next/link'

import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { CharacterChip } from './chip'

/**
 * The co-occurrence matrix: who shares scenes with whom.
 *
 * `Route - Characters.dc.html`, `isMap`: a grid with a 130px name column
 * and one `minmax(48px, 1fr)` column per character, a 22px chip per column
 * head, 34px cells. A cell is the number of scenes the two are in
 * together; its ground is the accent at an alpha that grows with the count
 * (`0.12 + n / 24`, capped at 0.85 - the bundle's own formula), white ink
 * past eight, `·` on a bare cell, and the diagonal blank. Row names open
 * the profile.
 *
 * "What stands out" lists the principals who never share a scene, one card
 * each, computed - the bundle's card is fixture prose about Kadam and
 * Farida; the sentence here is the fact, and the second line says what it
 * is a fact about. Nothing here calls a model.
 *
 * Every number is arithmetic over `scene_derivations` (`figures.ts`,
 * `buildMap`). The accent alpha is a `color-mix` over the `--accent` token,
 * so the cells follow the theme.
 */
export const WhoMeetsWhom = ({
  projectId,
  map,
  episodes,
  timelineHref,
}: {
  readonly projectId: ProjectId
  readonly map: CharacterMap
  readonly episodes: number
  readonly timelineHref: ProjectRoutePath
}) => {
  const columns = map.columns
  const template = `130px ${columns.map(() => 'minmax(48px,1fr)').join(' ')}`

  return (
    <div className="min-w-0 flex-1 overflow-auto px-[22px] pb-[60px] pt-[20px]" data-character-map>
      <div className="flex max-w-[900px] flex-col gap-[12px]">
        <p className="m-0 max-w-[70ch] text-11-5 leading-[1.5] text-ink2">
          Who shares scenes with whom. Each cell is the number of scenes two characters are in together; the darker,
          the more. Empty cells between principals are worth a look.
        </p>

        {columns.length === 0 ? (
          <div className="rounded-chrome border border-line bg-panel px-[14px] py-[12px] text-11-5 text-ink3">
            Nobody is in the script yet. The map fills in as cues are written.
          </div>
        ) : (
          <div className="overflow-auto rounded-chrome border border-line bg-panel">
            <div
              className="grid items-center gap-[4px] border-b border-line px-[14px] py-[9px]"
              style={{ gridTemplateColumns: template }}
            >
              <span />
              {columns.map((column) => (
                <span key={column.id} className="flex justify-center">
                  <span title={column.name}>
                    <CharacterChip name={column.name} hue={column.hue} size={22} />
                  </span>
                </span>
              ))}
            </div>
            {columns.map((row, i) => (
              <div
                key={row.id}
                className="grid items-center gap-[4px] border-b border-line2 px-[14px] py-[6px]"
                style={{ gridTemplateColumns: template }}
                data-map-row={row.id}
              >
                <Link
                  href={characterHref(projectId, row.id)}
                  className="truncate text-12 font-medium text-ink no-underline hover:text-accent hover:no-underline"
                >
                  {row.name}
                </Link>
                {columns.map((column, j) => {
                  const value = map.cells[i]?.[j] ?? 0
                  if (i === j) return <span key={column.id} className="h-[34px] rounded-chrome bg-line2" />
                  const alpha = value > 0 ? Math.min(0.85, 0.12 + value / 24) : 0
                  return (
                    <span
                      key={column.id}
                      title={`${row.name} & ${column.name} · ${String(value)} ${value === 1 ? 'scene' : 'scenes'}`}
                      data-map-cell={value}
                      className={`tabular grid h-[34px] place-items-center rounded-chrome border text-11 ${
                        value > 0 ? 'border-transparent' : 'border-line2 text-ink3'
                      }`}
                      style={{
                        background:
                          value > 0
                            ? `color-mix(in oklab, var(--accent) ${String(Math.round(alpha * 100))}%, transparent)`
                            : 'transparent',
                        color: value > 8 ? 'var(--chip-ink)' : value > 0 ? 'var(--ink)' : undefined,
                      }}
                    >
                      {value > 0 ? value : '·'}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-[8px]">
          <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">What stands out</span>
          {map.standouts.length === 0 ? (
            <div className="rounded-chrome border border-line2 bg-panel px-[12px] py-[10px] text-11-5 text-ink3">
              {columns.filter((column) => column.group === 'principal').length < 2
                ? 'Mark two or more characters as principals and the pairs who never meet are listed here.'
                : 'Every principal shares a scene with every other principal.'}
            </div>
          ) : (
            map.standouts.slice(0, 6).map((pair) => (
              <div
                key={`${pair.a.id}:${pair.b.id}`}
                className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-[12px] rounded-chrome border border-line2 bg-panel px-[12px] py-[10px]"
                data-standout
              >
                <span className="mt-[5px] h-[7px] w-[7px] rounded-full bg-note" />
                <div className="flex flex-col gap-[2px]">
                  <span className="font-serif text-15 leading-[1.4]">
                    {pair.a.name} and {pair.b.name} never share a scene.
                  </span>
                  <span className="text-11-5 leading-[1.5] text-ink2">
                    Two principals with no contact across {episodes} {episodes === 1 ? 'episode' : 'episodes'}. If that
                    is by design, the Timeline can hold it; if not, that is a scene.
                  </span>
                </div>
                <Link href={timelineHref} className="whitespace-nowrap pt-[3px] text-11">
                  Timeline →
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
