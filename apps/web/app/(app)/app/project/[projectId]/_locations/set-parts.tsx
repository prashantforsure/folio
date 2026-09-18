'use client'

import type { LocationStatus } from '@folio/contracts'
import { LOCATION_STATUS_LABELS } from '@folio/contracts'
import type { Quadrant } from '@folio/script'
import { Glyph } from '@folio/ui'
import Link from 'next/link'
import type { CSSProperties } from 'react'

import { initialsOf } from '../../../../../../lib/characters/cast'
import { QUADRANT_BOXES, hueOf, statusTone } from '../../../../../../lib/locations/view'
import type { CharacterPath } from '../../../../../../lib/workspace/hrefs'
import { CastMark } from '../_characters/cast-mark'

/**
 * The pieces the Locations views share since the rebuild (2026-09-18):
 *
 *   `setHue`       the record's hue as `--set-hue`, which `.folio-set-mark`
 *                  reads (`palette.css`: `--set-a/b/c`) - the sheet's mark
 *                  and the thumbnail's stand-in, nothing larger
 *   `SetMark`      the sheet's 26px gradient square with the `⌖`
 *   `Thumb`        the 28px photo beside a name, when there is one; the
 *                  mark otherwise. The 16:10 tile of the v2 pass is gone:
 *                  without `R2_*` it was a dashed empty box on every card
 *   `StatusDot`    the 6px dot in the status tone, its label in the title
 *   `CastStack`    the overlapping 17px avatars with `+N` past `max`, each
 *                  a link to the record; the click stops at the avatar
 *   `QuadrantBoxes` the four `INT D 3` boxes in mono, zeros included
 *
 * A scene ref as a linked chip is `lib/characters/figures.ts`'s `citeOf`,
 * the one function every record route's citation goes through.
 */

export const setHue = (id: string): CSSProperties => ({ '--set-hue': String(hueOf(id)) }) as CSSProperties

export const SetMark = ({ id, size = 26 }: { readonly id: string; readonly size?: number }) => (
  <span aria-hidden="true" className="folio-set-mark" style={{ ...setHue(id), width: size, height: size }}>
    <Glyph name="locations" className="text-11" />
  </span>
)

export const Thumb = ({ id, name, photoUrl, size = 28 }: { readonly id: string; readonly name: string; readonly photoUrl: string | null; readonly size?: number }) =>
  photoUrl === null ? (
    <SetMark id={id} size={size} />
  ) : (
    <img
      src={photoUrl}
      alt={`${name}, photographed`}
      data-thumb
      className="flex-none rounded-[7px] object-cover"
      style={{ width: size, height: size }}
    />
  )

export const StatusDot = ({ status, attr }: { readonly status: LocationStatus; readonly attr?: `data-${string}` }) => (
  <span
    className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full"
    data-tone={statusTone(status)}
    title={LOCATION_STATUS_LABELS[status]}
    {...(attr === undefined ? {} : { [attr]: status })}
  />
)

export const CastStack = ({
  people,
  attr,
  hrefOf,
  max = 3,
}: {
  readonly people: readonly { readonly id: string; readonly name: string; readonly hue: number; readonly scenes?: number }[]
  readonly attr?: `data-${string}`
  /** With it, each avatar links to the record (`/characters/:id`); the click stops at the avatar, not the card around it. */
  readonly hrefOf?: (id: string) => CharacterPath
  /** Past this many, the rest fold into `+N` with every name in the title. */
  readonly max?: number
}) => {
  const shown = people.slice(0, max)
  const rest = people.slice(max)
  return (
    <span className="flex flex-none items-center" {...(attr === undefined ? {} : { [attr]: people.length })}>
      {shown.map((person) => {
        const title = person.scenes === undefined ? person.name : `${person.name} · ${String(person.scenes)} ${person.scenes === 1 ? 'scene' : 'scenes'}`
        const mark = <CastMark initial={initialsOf(person.name)} hue={person.hue} size={17} radius="full" fontSize={8.5} />
        return hrefOf === undefined ? (
          <span key={person.id} title={title} className="-ml-[5px] flex-none rounded-full border-[1.5px] border-bg first:ml-0">
            {mark}
          </span>
        ) : (
          <Link
            key={person.id}
            href={hrefOf(person.id)}
            title={title}
            aria-label={person.name}
            data-cast-link={person.id}
            data-raised
            onClick={(event) => {
              event.stopPropagation()
            }}
            className="-ml-[5px] flex-none rounded-full border-[1.5px] border-bg first:ml-0 hover:z-[1] hover:border-accent"
          >
            {mark}
          </Link>
        )
      })}
      {rest.length === 0 ? null : (
        <span className="tabular ml-[4px] font-mono text-10-5 text-ink3" title={rest.map((person) => person.name).join(' · ')} data-cast-more={rest.length}>
          +{rest.length}
        </span>
      )}
    </span>
  )
}

export const QuadrantBoxes = ({ quadrant, attr }: { readonly quadrant: Quadrant; readonly attr?: `data-${string}` }) => (
  <span className="flex flex-wrap items-center gap-x-[10px] gap-y-[2px] font-mono text-10-5 text-ink3" {...(attr === undefined ? {} : { [attr]: '' })}>
    {QUADRANT_BOXES.map((box) => (
      <span key={box.key} className="tabular whitespace-nowrap" data-box={box.key}>
        {box.label} <span className={quadrant[box.key] === 0 ? '' : 'text-ink2'}>{quadrant[box.key]}</span>
      </span>
    ))}
    {quadrant.unlit === 0 ? null : (
      <span className="tabular whitespace-nowrap" data-box="unlit" title="Headings that say neither DAY nor NIGHT">
        unlit {quadrant.unlit}
      </span>
    )}
  </span>
)
