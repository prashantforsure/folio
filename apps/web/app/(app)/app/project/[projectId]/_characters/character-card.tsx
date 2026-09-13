'use client'

import type { CastRow, ProjectId } from '@folio/contracts'
import { CHARACTER_GENDER_LABELS, PORTRAIT_TYPES } from '@folio/contracts'
import Link from 'next/link'
import { useRef } from 'react'

import { uploadPortrait } from '../../../../../../lib/characters/actions'
import { factsLine } from '../../../../../../lib/characters/figures'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { Run } from './characters-workspace'
import { PortraitTile } from './portrait-tile'

/**
 * One character, as a card: the portrait tile (3:4, the colour until a
 * portrait is set) with the name and `Female · 17 y/o · student` over its
 * foot, the derived `N scenes` · `N lines` chips, three lines of bio, and
 * `✎ Edit` · `⇧ Upload` · `✦ Generate`.
 *
 * Edit is a link to `/characters/:id` - the drawer is the URL. Upload is a
 * file input behind a button; the bytes go through `uploadPortrait` and
 * never touch a storage credential in the browser. With storage not
 * configured the button is disabled and its title says so. Generate is
 * the look-sheet job that has no worker yet: drawn disabled, with the
 * reason as its title, and nothing behind it (`docs/build-decisions.md`,
 * "Not in this pass").
 */
export const CharacterCard = ({
  projectId,
  row,
  storage,
  run,
}: {
  readonly projectId: ProjectId
  readonly row: CastRow
  readonly storage: boolean
  readonly run: Run
}) => {
  const picker = useRef<HTMLInputElement>(null)
  const facts = factsLine({
    gender: row.gender === null ? null : CHARACTER_GENDER_LABELS[row.gender],
    age: row.age,
    role: row.role,
  })
  const href = characterHref(projectId, row.id)

  const upload = (file: File): void => {
    run(async () => {
      const form = new FormData()
      form.set('portrait', file)
      const result = await uploadPortrait(projectId, row.id, form)
      return result.status === 'saved' ? null : result.message
    })
  }

  return (
    <article
      data-character-card={row.id}
      data-presence={row.presence}
      className="flex flex-col gap-[10px] rounded-card border border-line bg-panel p-[10px]"
    >
      <Link href={href} className="block no-underline hover:no-underline" aria-label={`Edit ${row.name}`}>
        <PortraitTile hue={row.hue} portraitUrl={row.portraitUrl} name={row.name} className="aspect-[3/4] rounded-[7px]">
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col gap-[3px] px-[14px] pb-[14px] pt-[40px]"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0))' }}
          >
            <span className="truncate text-16 font-semibold" style={{ color: 'var(--chip-ink)' }}>
              {row.name}
            </span>
            {facts === '' ? null : (
              <span className="line-clamp-2 text-11-5 leading-[1.4] opacity-90" style={{ color: 'var(--chip-ink)' }}>
                {facts}
              </span>
            )}
          </div>
        </PortraitTile>
      </Link>

      <div className="flex flex-wrap gap-[6px]">
        <Stat glyph="▤" value={row.appearances} unit="scenes" />
        <Stat glyph="❝" value={row.lines} unit="lines" />
        {row.presence === 'absent' ? (
          <span className="rounded-full border border-dashed border-line px-[8px] py-[2px] text-10 text-ink3" title="Not in the script. The record is kept.">
            record kept
          </span>
        ) : null}
      </div>

      <p className="m-0 line-clamp-3 min-h-[3em] text-11-5 leading-[1.5] text-ink2">
        {row.bio === null || row.bio === '' ? <span className="text-ink3">No bio yet.</span> : row.bio}
      </p>

      <div className="grid grid-cols-2 gap-[6px]">
        <Link href={href} data-card-edit className={`${BUTTON} no-underline hover:no-underline`}>
          <Glyph>✎</Glyph> Edit
        </Link>
        <button
          type="button"
          disabled={!storage}
          title={storage ? 'Upload a portrait' : 'Portrait storage is not set up on this server yet.'}
          data-card-upload
          onClick={() => {
            picker.current?.click()
          }}
          className={BUTTON}
        >
          <Glyph>⇧</Glyph> Upload
        </button>
        <input
          ref={picker}
          type="file"
          accept={PORTRAIT_TYPES.join(',')}
          aria-label={`Portrait for ${row.name}`}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined) upload(file)
          }}
        />
        <button
          type="button"
          disabled
          title="Generation needs a worker — not yet."
          data-card-generate
          className={`${BUTTON} col-span-2`}
        >
          <Glyph>✦</Glyph> Generate
        </button>
      </div>
    </article>
  )
}

const BUTTON =
  'flex items-center justify-center gap-[6px] rounded-chrome border border-line2 bg-transparent px-[10px] py-[7px] text-11-5 font-medium text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

const Glyph = ({ children }: { readonly children: string }) => (
  <span aria-hidden="true" className="text-10-5 opacity-70" style={{ fontFamily: 'var(--font-glyph)' }}>
    {children}
  </span>
)

const Stat = ({ glyph, value, unit }: { readonly glyph: string; readonly value: number; readonly unit: string }) => (
  <span className="tabular inline-flex items-center gap-[5px] rounded-full border border-line2 bg-sheet px-[8px] py-[2px] text-10-5 text-ink2">
    <Glyph>{glyph}</Glyph>
    {value} {unit}
  </span>
)
