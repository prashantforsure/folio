'use client'

import type { LocationStatus } from '@folio/contracts'
import { LOCATION_STATUS_LABELS } from '@folio/contracts'
import { Glyph } from '@folio/ui'
import type { CSSProperties, ReactNode } from 'react'

import { initialsOf } from '../../../../../../lib/characters/cast'
import { hueOf, statusTone } from '../../../../../../lib/locations/view'
import { CastMark } from '../_characters/cast-mark'

/**
 * The pieces the Locations views share - `Route - Locations v2.dc.html`:
 *
 *   `setHue`      the record's hue as `--set-hue`, which `.folio-set-mark`
 *                 reads (`palette.css`: `--set-a/b/c`)
 *   `SetTile`     the 16:10 photo tile: the photo with the mockup's scrim,
 *                 or the dashed inset with the `⌖` and `Drop a photo`; the
 *                 status badge top right; the caller's foot over it
 *   `SetMark`     the sheet's 26px gradient square with the `⌖`
 *   `StatusBadge` the tile's badge: `--bg` on `--line2`, 6px radius, 10px,
 *                 in the status tone (`.folio-cast-badge` - the same badge
 *                 the Characters card draws)
 *   `CastStack`   the overlapping 20px avatars: `1.5px` of `--bg` around
 *                 each, `-5px` apart, the name and count in the title
 */

export const setHue = (id: string): CSSProperties => ({ '--set-hue': String(hueOf(id)) }) as CSSProperties

export const StatusBadge = ({ status }: { readonly status: LocationStatus }) => (
  <span className="folio-cast-badge folio-tone-ink" data-tone={statusTone(status)} data-card-status>
    {LOCATION_STATUS_LABELS[status]}
  </span>
)

export const SetTile = ({
  id,
  name,
  photoUrl,
  status,
  hint,
  glyph = true,
  over = false,
  className = '',
  children,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  readonly id: string
  readonly name: string
  readonly photoUrl: string | null
  readonly status: LocationStatus | null
  /** `Drop a photo` under the glyph; not drawn without storage. */
  readonly hint: boolean
  /** The `⌖` in the empty tile; the drawer's tile draws its buttons there instead. */
  readonly glyph?: boolean
  /** A file is over the tile: the dashed inset turns `--accent`. */
  readonly over?: boolean
  readonly className?: string
  /** The foot: the name and the kind line, over the scrim. */
  readonly children?: ReactNode
  readonly onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  readonly onDragLeave?: () => void
  readonly onDrop?: (event: React.DragEvent<HTMLDivElement>) => void
}) => (
  <div
    data-set-tile
    data-has-photo={photoUrl === null ? 'false' : 'true'}
    className={`relative flex flex-none items-center justify-center overflow-hidden bg-sunk ${className}`}
    style={{ aspectRatio: '16 / 10', ...setHue(id) }}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
  >
    {photoUrl === null ? (
      <span aria-hidden="true" className="absolute inset-[10px] rounded-[9px] border border-dashed" style={{ borderColor: over ? 'var(--accent)' : 'var(--line)' }} />
    ) : (
      <img src={photoUrl} alt={`${name}, photographed`} className="absolute inset-0 h-full w-full object-cover" />
    )}
    {photoUrl === null && glyph ? (
      <span className="relative flex flex-col items-center gap-[8px] pb-[30px]">
        <Glyph name="locations" className="text-[34px] text-ink3" />
        {hint ? <span className="text-11 text-ink3">Drop a photo</span> : null}
      </span>
    ) : null}
    {status === null ? null : <StatusBadge status={status} />}
    {children}
  </div>
)

/** The foot over the tile: the name at 15px/500 and the mono kind line, on `--bg` or over the scrim. */
export const TileFoot = ({ name, line, photo }: { readonly name: string; readonly line: string; readonly photo: boolean }) => (
  <span
    className="absolute inset-x-0 bottom-0 flex flex-col gap-[2px]"
    style={
      photo
        ? { padding: '26px 12px 11px', background: 'linear-gradient(to bottom, transparent, var(--cast-scrim-mid) 38%, var(--cast-scrim-end))' }
        : { padding: '9px 12px 10px', background: 'var(--bg)' }
    }
  >
    <span className="truncate text-15 font-medium tracking-title" style={{ color: photo ? 'var(--cast-face-name)' : 'var(--ink)' }} data-card-name>
      {name}
    </span>
    <span className="truncate font-mono text-10-5" style={{ color: photo ? 'var(--cast-face-sub)' : 'var(--ink3)' }} data-card-kind>
      {line}
    </span>
  </span>
)

export const SetMark = ({ id }: { readonly id: string }) => (
  <span aria-hidden="true" className="folio-set-mark" style={setHue(id)}>
    <Glyph name="locations" className="text-11" />
  </span>
)

export const CastStack = ({
  people,
  attr,
}: {
  readonly people: readonly { readonly id: string; readonly name: string; readonly hue: number; readonly scenes?: number }[]
  readonly attr?: `data-${string}`
}) => (
  <span className="flex flex-none items-center" {...(attr === undefined ? {} : { [attr]: people.length })}>
    {people.map((person) => (
      <span
        key={person.id}
        title={person.scenes === undefined ? person.name : `${person.name} · ${String(person.scenes)} ${person.scenes === 1 ? 'scene' : 'scenes'}`}
        className="-ml-[5px] flex-none rounded-full border-[1.5px] border-bg first:ml-0"
      >
        <CastMark initial={initialsOf(person.name)} hue={person.hue} size={17} radius="full" fontSize={8.5} />
      </span>
    ))}
  </span>
)
