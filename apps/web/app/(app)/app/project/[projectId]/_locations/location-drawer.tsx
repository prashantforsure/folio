'use client'

import type { LocationRow, ProjectId } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'
import { canonicalKey, readSlugline } from '@folio/script'
import { EpisodeBars } from '@folio/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'

import {
  bindSluglineAlias,
  deleteLocation,
  mergeLocations,
  removeLocationPhoto,
  renameLocation,
  saveLocation,
  setParent,
  unbindSluglineAlias,
  uploadLocationPhoto,
} from '../../../../../../lib/locations/actions'
import { subtreeOf } from '../../../../../../lib/locations/figures'
import { metaLong, sluglineNote } from '../../../../../../lib/locations/view'
import { initialsOf } from '../../../../../../lib/characters/cast'
import { count } from '../../../../../../lib/workspace/format'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import { CastMark } from '../_characters/cast-mark'
import { DrawerNotice, SectionHead } from '../_chrome/drawer-parts'
import { DrawerShell, Section } from '../_chrome/drawer-shell'
import type { Run } from '../_chrome/use-run'
import type { LocationDraft } from './location-fields'
import { LocationFields } from './location-fields'
import { SetTile } from './set-parts'

/**
 * `/locations/:locationId` - the edit drawer, `Route - Locations
 * v2.dc.html`: `Edit location` over `9 scenes · 41 2/8 pages · first in E1
 * Sc 1`; the 16:10 tile with `Upload photo` / `Remove`; the fields
 * (`location-fields.tsx`); `Sluglines here · 15 in the script` as mono
 * chips with counts; `Who's here` with its `→ Characters`; and the foot -
 * `Delete` left, `Cancel` / `Save` right (README, "Drawer").
 *
 * ## What is drawn that the mockup does not draw, and why
 *
 * The README's episode bars under the meta line, on a series - the
 * per-episode distribution the brief keeps and the mockup has no place
 * for on a card. A `×` on a bound set text and `+ Bind a set text` under
 * the chips: the alias table is what makes `THE CHAWL` and `KAMATHI CHAWL`
 * one place and the only place a writer can see and change it; the
 * mockup's chips are the counted headings and are kept as drawn.
 *
 * ## Save is one write; a changed name is a rename first
 *
 * The fields are a draft until `Save`, written in one `saveLocation`
 * (description, address, status) plus `setParent` when the edge moved. A
 * changed name is not a field: it is the sanctioned write-back (AGENTS.md,
 * "Derivation is one-way - except": every heading whose set is the name),
 * so the drawer asks in place - "Rename everywhere? N headings will read
 * X" - and runs `renameLocation` first on yes.
 *
 * ## Delete, and merge inside it
 *
 * The action refuses a delete while the record is in the script (a record
 * deleted under a live heading is minted again on the next pass). The
 * mockup's foot has `Delete` alone, so `Merge into…` - the way two records
 * that were one place become one - lives inside it: pressing Delete on a
 * present record offers the merge in the foot instead of a refusal.
 */
export const LocationDrawer = ({
  projectId,
  row,
  rows,
  episodes,
  storage,
  baseHref,
  charactersHref,
  run,
}: {
  readonly projectId: ProjectId
  readonly row: LocationRow
  /** Every record, for the parent and merge pickers. */
  readonly rows: readonly LocationRow[]
  readonly episodes: number
  readonly storage: boolean
  readonly baseHref: ProjectRoutePath
  readonly charactersHref: ProjectRoutePath
  readonly run: Run
}) => {
  const router = useRouter()
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<LocationDraft>({
    name: row.name,
    address: row.address ?? '',
    description: row.description ?? '',
    status: row.status,
    parentId: row.parentId ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rename' | 'delete' | 'merge' | null>(null)
  const [winner, setWinner] = useState('')
  const [binding, setBinding] = useState(false)
  const [alias, setAlias] = useState('')
  const close = useCallback(() => {
    router.push(baseHref)
  }, [baseHref, router])

  const renamed = draft.name.trim() !== '' && draft.name.trim() !== row.name
  const onPage = row.presence === 'present' || row.rollup.scenes > 0
  const own = subtreeOf(row.id, rows)
  const parents = rows.filter((entry) => !own.has(entry.id) && entry.parentId === null).map((entry) => ({ id: entry.id, name: entry.name }))
  const others = rows.filter((entry) => entry.id !== row.id)

  const finish = (failure: string | null): string | null => {
    setBusy(false)
    if (failure !== null) setNotice(failure)
    return failure
  }

  const save = (withRename: boolean): void => {
    if (draft.name.trim() === '') {
      setNotice('A location needs a name.')
      return
    }
    if (renamed && !withRename && confirm !== 'rename') {
      setConfirm('rename')
      return
    }
    setBusy(true)
    setNotice(null)
    setConfirm(null)
    run(async () => {
      if (renamed && withRename) {
        const result = await renameLocation(projectId, row.id, draft.name.trim())
        if (result.status !== 'renamed') return finish(result.message)
      }
      const saved = await saveLocation(projectId, row.id, {
        description: draft.description,
        address: draft.address,
        status: draft.status,
      })
      if (saved.status !== 'saved') return finish(saved.message)
      if (draft.parentId !== (row.parentId ?? '')) {
        const moved = await setParent(projectId, row.id, draft.parentId === '' ? null : draft.parentId)
        if (moved.status !== 'saved') return finish(moved.message)
      }
      setBusy(false)
      router.push(baseHref)
      return null
    })
  }

  const upload = (file: File): void => {
    setBusy(true)
    run(async () => {
      const form = new FormData()
      form.set('photo', file)
      const result = await uploadLocationPhoto(projectId, row.id, form)
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  const removePhoto = (): void => {
    setBusy(true)
    run(async () => {
      const result = await removeLocationPhoto(projectId, row.id)
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  const destroy = (): void => {
    setBusy(true)
    setConfirm(null)
    run(async () => {
      const result = await deleteLocation(projectId, row.id)
      if (result.status !== 'deleted') return finish(result.message)
      setBusy(false)
      router.push(baseHref)
      return null
    })
  }

  const merge = (): void => {
    if (winner === '') return
    setBusy(true)
    setConfirm(null)
    run(async () => {
      const result = await mergeLocations(projectId, row.id, winner)
      if (result.status !== 'merged') return finish(result.message)
      setBusy(false)
      router.push(locationHref(projectId, result.into))
      return null
    })
  }

  const bind = (): void => {
    const set = alias.trim()
    if (set === '') return
    setBusy(true)
    run(async () => {
      const result = await bindSluglineAlias(projectId, row.id, set)
      if (result.status !== 'bound') return finish(result.message)
      setAlias('')
      setBinding(false)
      return finish(null)
    })
  }

  const unbind = (set: string): void => {
    setBusy(true)
    run(async () => {
      const result = await unbindSluglineAlias(projectId, row.id, set)
      return finish(result.status === 'saved' ? null : result.message)
    })
  }

  // A bound set text no counted heading reads down to: authored, not yet on the page.
  const countedKeys = new Set(
    row.sluglines.map((entry) => {
      const reading = readSlugline(entry.slugline)
      return canonicalKey(reading.ok ? reading.value.set : entry.slugline)
    }),
  )
  const uncounted = row.boundSluglines.filter((set) => !countedKeys.has(canonicalKey(set)))

  return (
    <DrawerShell
      title="Edit location"
      meta={metaLong(row)}
      label={`Edit ${row.name}`}
      route="locations"
      onClose={close}
      footer={
        confirm === 'delete' ? (
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Delete {row.name}? The record goes; the script is untouched.
            </span>
            <button type="button" data-delete-keep onClick={() => setConfirm(null)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Keep
            </button>
            <button type="button" data-delete-confirm onClick={destroy} className="folio-line-button h-[34px] flex-none rounded-[9px] border-live px-[14px] text-live hover:border-live hover:bg-live-bg hover:text-live">
              Delete
            </button>
          </>
        ) : confirm === 'merge' ? (
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Still in the script ({count(row.rollup.scenes)} {row.rollup.scenes === 1 ? 'scene' : 'scenes'}). Merge it into another location instead:
            </span>
            <select
              aria-label="Merge into"
              data-merge-into
              value={winner}
              onChange={(event) => {
                setWinner(event.target.value)
              }}
              className="folio-field h-[34px] max-w-[150px] rounded-[9px] py-0 text-12"
            >
              <option value="">Pick a location</option>
              {others.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <button type="button" data-merge-cancel onClick={() => setConfirm(null)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Keep
            </button>
            <button type="button" data-merge-confirm disabled={winner === ''} onClick={merge} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[14px] text-12-5 font-medium">
              Merge
            </button>
          </>
        ) : confirm === 'rename' ? (
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Rename everywhere? {row.nameHeadings} {row.nameHeadings === 1 ? 'heading' : 'headings'} in the script will read {draft.name.trim()}.
            </span>
            <button type="button" data-rename-cancel onClick={() => setConfirm(null)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Keep the name
            </button>
            <button type="button" data-rename-confirm onClick={() => save(true)} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[14px] text-12-5 font-medium">
              Rename
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              data-drawer-delete
              disabled={busy}
              title={onPage ? 'Still in the script. Pressing this offers a merge instead.' : 'Delete this record'}
              onClick={() => {
                setConfirm(onPage ? 'merge' : 'delete')
              }}
              className="folio-delete-button h-[34px] flex-none rounded-[9px] px-[13px] text-12-5"
            >
              Delete
            </button>
            <DrawerNotice notice={notice} />
            <div className="flex-1" />
            <button type="button" data-drawer-cancel disabled={busy} onClick={close} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Cancel
            </button>
            <button type="button" data-drawer-save disabled={busy} onClick={() => save(false)} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[18px] text-12-5 font-medium">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        )
      }
    >
      {episodes > 1 ? <EpisodeBars counts={row.perEpisode} className="-mt-[10px]" /> : null}

      <SetTile
        id={row.id}
        name={row.name}
        photoUrl={row.photoUrl}
        status={null}
        hint={false}
        glyph={false}
        className={`rounded-[11px] border ${row.photoUrl === null ? 'border-dashed border-line' : 'border-line2'}`}
      >
        <div className="relative flex items-center gap-[8px]">
          <button
            type="button"
            data-drawer-upload
            disabled={busy || !storage}
            title={storage ? 'A photo of the place' : 'Photo storage is not set up on this server yet.'}
            onClick={() => {
              picker.current?.click()
            }}
            className="h-[30px] cursor-pointer rounded-[9px] border border-line bg-bg px-[13px] text-12-5 text-ink hover:opacity-[.88] disabled:cursor-default disabled:opacity-50"
          >
            Upload photo
          </button>
          <input
            ref={picker}
            type="file"
            accept={PORTRAIT_TYPES.join(',')}
            aria-label={`Photo of ${row.name}`}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file !== undefined) upload(file)
            }}
          />
          {row.photoUrl === null ? null : (
            <button
              type="button"
              data-drawer-remove-photo
              disabled={busy}
              onClick={removePhoto}
              className="h-[30px] cursor-pointer rounded-[9px] border border-line2 bg-transparent px-[13px] text-12-5 text-ink3 hover:opacity-[.88] disabled:cursor-default disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </SetTile>

      <LocationFields draft={draft} onChange={setDraft} busy={busy} row={row} parents={parents} />

      <Section>
        <SectionHead label="Sluglines here">
          <span className="text-11 text-ink3" data-slugline-note>
            {sluglineNote(row.sluglines)}
          </span>
        </SectionHead>
        <div className="flex flex-wrap gap-[6px]" data-sluglines={row.sluglines.length}>
          {row.sluglines.map((entry) => (
            <span key={entry.slugline} className="inline-flex items-center gap-[7px] rounded-[7px] border border-line2 bg-s1 px-[9px] py-[3px] font-mono text-10-5 uppercase text-ink2" data-slugline-chip>
              {entry.slugline}
              <span className="text-ink3">× {entry.occurrences}</span>
            </span>
          ))}
          {uncounted.map((set) => (
            <span key={set} className="inline-flex items-center gap-[7px] rounded-[7px] border border-dashed border-line2 bg-transparent px-[9px] py-[3px] font-mono text-10-5 uppercase text-ink3" data-bound-chip title="Bound to this record; no heading uses it yet">
              {set}
              {row.boundSluglines.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Unbind ${set}`}
                  data-unbind={set}
                  disabled={busy}
                  onClick={() => {
                    unbind(set)
                  }}
                  className="folio-ghost-button -mr-[4px] grid h-[16px] w-[16px] place-items-center rounded-[4px] text-10 text-ink3"
                >
                  ✕
                </button>
              ) : null}
            </span>
          ))}
          {binding ? (
            <form
              className="flex items-center gap-[6px]"
              onSubmit={(event) => {
                event.preventDefault()
                bind()
              }}
            >
              <input
                autoFocus
                type="text"
                value={alias}
                disabled={busy}
                data-bind-input
                placeholder="THE CHAWL"
                aria-label="A set text to bind"
                onChange={(event) => {
                  setAlias(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setBinding(false)
                }}
                className="folio-field h-[24px] w-[150px] rounded-[7px] py-0 font-mono text-10-5 uppercase"
              />
              <button type="submit" data-bind-submit disabled={busy || alias.trim() === ''} className="folio-line-button h-[24px] rounded-[7px] px-[8px] text-11">
                Bind
              </button>
            </form>
          ) : (
            <button
              type="button"
              data-bind-open
              disabled={busy}
              onClick={() => {
                setBinding(true)
              }}
              className="folio-ghost-button rounded-[7px] px-[8px] py-[3px] text-11 text-ink3 hover:!text-ink2"
            >
              + Bind a set text
            </button>
          )}
        </div>
      </Section>

      <Section>
        <SectionHead label="Who's here">
          <Link href={charactersHref} data-drawer-characters className="text-11 text-accent no-underline hover:underline">
            → Characters
          </Link>
        </SectionHead>
        {row.people.length === 0 ? (
          <span className="text-11 text-ink3" data-people="none">
            {onPage ? 'Nobody named in these scenes.' : 'Not on the page yet'}
          </span>
        ) : (
          <div className="flex flex-col gap-[2px]" data-people={row.people.length}>
            {row.people.map((person) => (
              <div key={person.id} className="flex min-w-0 items-center gap-[10px] py-[7px]" data-person={person.id}>
                <CastMark initial={initialsOf(person.name)} hue={person.hue} size={22} radius={7} fontSize={9} />
                <span className="min-w-0 flex-1 truncate text-12-5">{person.name}</span>
                <span className="tabular flex-none font-mono text-10-5 text-ink3">{person.scenes} sc</span>
              </div>
            ))}
          </div>
        )}
      </Section>

    </DrawerShell>
  )
}
