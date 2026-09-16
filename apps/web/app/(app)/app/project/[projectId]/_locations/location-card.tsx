'use client'

import type { LocationRow, ProjectId, StructureResolveItem } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { resolveStructure, uploadLocationPhoto } from '../../../../../../lib/locations/actions'
import { ieKindLine, metaLine } from '../../../../../../lib/locations/view'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import { ConflictBlock } from '../_chrome/conflict-block'
import type { Run } from '../_chrome/use-run'
import { CastStack, SetTile, TileFoot } from './set-parts'

/**
 * One location, as `Route - Locations v2.dc.html` draws the card: a `--s1`
 * card at a 14px radius; the 16:10 tile on `--sunk` - the photo with a
 * scrim and the name in white over its foot, or the dashed inset with the
 * `⌖`, `Drop a photo` and the name on `--bg` - the status badge top right;
 * then the description (12.5px, three lines), and the foot: `9 scenes ·
 * 41 2/8 pp` in mono beside the overlapping cast avatars.
 *
 * The card is a link to `/locations/:id`, the drawer. `aria-current` while
 * that record is the drawer's: the border is `--line`. A conflict - an
 * open structure proposal about this record, "reads like part of Kamathi
 * Chawl" - turns the border `--warn` and draws the README's amber block
 * under the description with `Move it inside` / `It's deliberate`
 * (`_chrome/conflict-block.tsx`). Accepting writes the tree edge; the
 * script is not changed either way.
 *
 * `Drop a photo` is real: a file dropped on the tile uploads as the photo,
 * through `uploadLocationPhoto`, with storage configured; without it the
 * hint is not drawn and nothing accepts a drop. The `⌖` the mockup draws
 * over its gradient stand-in is not drawn over a real photograph.
 */
export const LocationCard = ({
  projectId,
  row,
  selected,
  storage,
  run,
}: {
  readonly projectId: ProjectId
  readonly row: LocationRow
  readonly selected: boolean
  readonly storage: boolean
  readonly run: Run
}) => {
  const router = useRouter()
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const href = locationHref(projectId, row.id)
  const conflict = row.conflicts[0]

  const upload = (file: File): void => {
    if (!PORTRAIT_TYPES.includes(file.type as (typeof PORTRAIT_TYPES)[number])) return
    run(async () => {
      const form = new FormData()
      form.set('photo', file)
      const result = await uploadLocationPhoto(projectId, row.id, form)
      return result.status === 'saved' ? null : result.message
    })
  }

  const decide = (item: StructureResolveItem, choice: 'accept' | 'reject'): void => {
    setBusy(true)
    run(async () => {
      const result = await resolveStructure(projectId, item.key, { kind: choice })
      setBusy(false)
      return result.status === 'resolved' ? null : result.message
    })
  }

  return (
    <article
      data-location-card={row.id}
      data-status={row.status}
      data-kind={row.kind}
      data-conflict={conflict === undefined ? 'false' : 'true'}
      aria-current={selected ? 'true' : undefined}
      className="folio-cast-card"
      onClick={() => {
        router.push(href)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') router.push(href)
      }}
      role="link"
      tabIndex={0}
      aria-label={`Edit ${row.name}`}
    >
      <SetTile
        id={row.id}
        name={row.name}
        photoUrl={row.photoUrl}
        status={row.status}
        hint={storage}
        over={over}
        onDragOver={(event) => {
          if (!storage) return
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => {
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
        <TileFoot name={row.name} line={ieKindLine(row)} photo={row.photoUrl !== null} />
      </SetTile>

      <div className="flex min-w-0 flex-1 flex-col gap-[11px] p-[12px]">
        <p className={`m-0 line-clamp-3 text-12-5 leading-[1.5] ${row.description === null ? 'text-ink3' : 'text-ink2'}`} style={{ textWrap: 'pretty' }} data-card-line>
          {row.description ?? 'No description yet'}
        </p>
        {conflict === undefined ? null : (
          <ConflictBlock
            title={
              conflict.proposal.kind === 'attach'
                ? `${row.name} reads like part of ${conflict.proposal.parent.name}.`
                : `${row.name} reads like part of a set called ${conflict.proposal.name}.`
            }
            detail={
              conflict.proposal.kind === 'attach'
                ? `${String(conflict.scenes)} ${conflict.scenes === 1 ? 'heading names' : 'headings name'} it that way. Moving it inside counts its scenes in ${conflict.proposal.parent.name}'s total; the script is not changed.`
                : `${String(conflict.scenes)} ${conflict.scenes === 1 ? 'heading names' : 'headings name'} it that way. Moving it inside makes ${conflict.proposal.name} a primary set with this one under it; the script is not changed.`
            }
            accept="Move it inside"
            busy={busy}
            onAccept={() => {
              decide(conflict, 'accept')
            }}
            onDeliberate={() => {
              decide(conflict, 'reject')
            }}
          />
        )}
        <div className="mt-auto flex items-center gap-[10px]">
          <span className="tabular min-w-0 flex-1 font-mono text-10-5 text-ink3" data-card-scenes>
            {metaLine(row)}
          </span>
          <CastStack people={row.people} attr="data-card-cast" />
        </div>
      </div>
    </article>
  )
}
