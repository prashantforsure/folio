'use client'

import type { ProjectId, PropRow } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useState } from 'react'
import type { CSSProperties } from 'react'

import { uploadPropPhoto } from '../../../../../../lib/props/actions'
import { hueOf, metaLine, productionLine, statusTone } from '../../../../../../lib/props/view'
import { propHref } from '../../../../../../lib/workspace/hrefs'
import type { Run } from '../_chrome/use-run'

/**
 * One prop as a card, the Locations card's shape: content first, the
 * picture second. A `--s1` card on `.folio-record-card` whose head is the
 * 28px thumbnail (a photo when there is one, the hue mark otherwise), the
 * status dot, and the name as the stretched link (`.folio-record-link`, so
 * the whole card opens the drawer and a middle-click opens a tab) over
 * `Hand prop · 4 scenes` in mono; then what the page says about it - the
 * first line of evidence quoted, or the description; then the foot: the
 * bound spellings as chips, and what Production already needs it for.
 *
 * Interactive pieces inside the card sit above the stretched link on
 * `[data-raised]` (the CSS), so a chip is its own click. `Drop a photo` is
 * real: a file dropped anywhere on the card uploads as the photo, with
 * storage configured (`data-over` draws the dashed outline).
 */
export const PropCard = ({
  projectId,
  row,
  selected,
  storage,
  run,
}: {
  readonly projectId: ProjectId
  readonly row: PropRow
  readonly selected: boolean
  readonly storage: boolean
  readonly run: Run
}) => {
  const [over, setOver] = useState(false)
  const href = propHref(projectId, row.id)
  const line = row.evidence[0]?.text ?? row.description
  const needed = productionLine(row)

  const upload = (file: File): void => {
    if (!PORTRAIT_TYPES.includes(file.type as (typeof PORTRAIT_TYPES)[number])) return
    run(async () => {
      const form = new FormData()
      form.set('photo', file)
      const result = await uploadPropPhoto(projectId, row.id, form)
      return result.status === 'saved' ? null : result.message
    })
  }

  return (
    <article
      data-prop-card={row.id}
      data-status={row.status}
      data-over={over ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
      className="folio-record-card"
      onDragOver={(event) => {
        if (!storage) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setOver(false)
      }}
      onDrop={(event) => {
        if (!storage) return
        event.preventDefault()
        setOver(false)
        const file = event.dataTransfer.files[0]
        if (file !== undefined) upload(file)
      }}
    >
      <div className="flex items-start gap-[10px]">
        <span className="flex-none pt-[1px]" data-card-thumb={row.photoUrl === null ? 'mark' : 'photo'}>
          <PropThumb id={row.id} name={row.name} photoUrl={row.photoUrl} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="flex min-w-0 items-center gap-[7px]">
            <span className="folio-tone-fill h-[6px] w-[6px] flex-none rounded-full" data-tone={statusTone(row.status)} data-card-status={row.status} />
            <Link href={href} className="folio-record-link min-w-0 truncate text-14-5 font-medium tracking-title" data-card-link data-card-name>
              {row.name}
            </Link>
          </span>
          <span className="truncate font-mono text-10-5 text-ink3" data-card-meta>
            {metaLine(row)}
          </span>
        </span>
      </div>

      <p
        className={`m-0 line-clamp-2 text-12-5 leading-[1.5] ${line === null ? 'text-ink3' : 'text-ink2'}`}
        style={{ textWrap: 'pretty' }}
        data-card-line={row.evidence.length > 0 ? 'evidence' : row.description === null ? 'none' : 'description'}
      >
        {line ?? 'Nothing written about it yet.'}
      </p>

      {row.bound.length === 0 ? null : (
        <span className="flex flex-wrap items-center gap-[4px]" data-card-aliases={row.bound.length}>
          <span className="folio-eyebrow mr-[2px]">Called</span>
          {row.bound.slice(0, 3).map((entry) => (
            <span key={entry.alias} className="folio-cite" data-card-alias={entry.alias} title={`${String(entry.lines)} ${entry.lines === 1 ? 'line' : 'lines'}`}>
              {entry.alias}
            </span>
          ))}
          {row.bound.length > 3 ? (
            <span className="tabular font-mono text-10-5 text-ink3" data-card-alias-more={row.bound.length - 3}>
              +{row.bound.length - 3}
            </span>
          ) : null}
        </span>
      )}

      <div className="mt-auto flex min-w-0 items-center gap-[8px] pt-[2px]">
        <span className="tabular min-w-0 flex-1 truncate font-mono text-10-5 text-ink3" data-card-production>
          {needed === '' ? `${String(row.lines)} ${row.lines === 1 ? 'line' : 'lines'} in the script` : needed}
        </span>
      </div>
    </article>
  )
}

/** The record's hue as `--set-hue`, which `.folio-set-mark` reads (`palette.css`). */
const propHue = (id: string): CSSProperties => ({ '--set-hue': String(hueOf(id)) }) as CSSProperties

/** The 28px photo beside a name, when there is one; the crate mark otherwise - the Locations `Thumb`, for a prop. */
export const PropThumb = ({
  id,
  name,
  photoUrl,
  size = 28,
}: {
  readonly id: string
  readonly name: string
  readonly photoUrl: string | null
  readonly size?: number
}) =>
  photoUrl === null ? (
    <span
      aria-hidden="true"
      className="folio-set-mark"
      style={{ ...propHue(id), width: size, height: size }}
    >
      <Icon name="props" size={Math.round(size * 0.46)} strokeWidth={1.4} />
    </span>
  ) : (
    <img src={photoUrl} alt={`${name}, photographed`} data-thumb className="flex-none rounded-[7px] object-cover" style={{ width: size, height: size }} />
  )
