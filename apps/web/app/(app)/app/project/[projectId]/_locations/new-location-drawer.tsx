'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { createLocation, saveLocation } from '../../../../../../lib/locations/actions'
import { setNewLocationOpen, useNewLocationOpen } from '../../../../../../lib/locations/compose'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import { DrawerNotice } from '../_chrome/drawer-parts'
import { DrawerShell } from '../_chrome/drawer-shell'
import type { LocationDraft } from './location-fields'
import { LocationFields } from './location-fields'

/**
 * `New location` - the edit drawer's shape with nothing to edit yet
 * (`Route - Locations v2.dc.html` opens the same drawer for `+`). The
 * fields, then `Cancel` / `Create`; no photo tile, no sluglines, no cast -
 * a record that is not yet in the script has none. On create the drawer
 * becomes the record's own: the router goes to `/locations/:id`.
 *
 * Opened through `lib/locations/compose.ts` from the sidebar's `+`, the
 * toolbar's `＋ New`, the grid's dashed tile and the empty card's `＋ By
 * hand`; mounted by the layout so every door reaches it. `createLocation`
 * mints the record with its name bound as its set text and the parent
 * chosen; the address, description and status are one `saveLocation` after
 * it, so a record is never half-made.
 */
const EMPTY: LocationDraft = { name: '', address: '', description: '', status: 'pending', parentId: '' }

export const NewLocationDrawer = ({
  projectId,
  parents,
}: {
  readonly projectId: ProjectId
  /** The primary sets a new record may hang under. */
  readonly parents: readonly { readonly id: string; readonly name: string }[]
}) => {
  const open = useNewLocationOpen()
  return open ? <NewLocationForm projectId={projectId} parents={parents} /> : null
}

const NewLocationForm = ({ projectId, parents }: { readonly projectId: ProjectId; readonly parents: readonly { readonly id: string; readonly name: string }[] }) => {
  const router = useRouter()
  const [draft, setDraft] = useState<LocationDraft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const close = useCallback(() => {
    setNewLocationOpen(false)
  }, [])

  const create = (): void => {
    const name = draft.name.trim()
    if (name === '') {
      setNotice('A location needs a name.')
      return
    }
    setBusy(true)
    setNotice(null)
    void (async () => {
      const created = await createLocation(projectId, name, draft.parentId === '' ? null : draft.parentId)
      if (created.status !== 'created') {
        setBusy(false)
        setNotice(created.message)
        return
      }
      if (draft.address.trim() !== '' || draft.description.trim() !== '' || draft.status !== 'pending') {
        const saved = await saveLocation(projectId, created.id, { address: draft.address, description: draft.description, status: draft.status })
        if (saved.status !== 'saved') {
          setBusy(false)
          setNotice(saved.message)
          return
        }
      }
      setBusy(false)
      setNewLocationOpen(false)
      router.push(locationHref(projectId, created.id))
    })()
  }

  return (
    <DrawerShell
      title="New location"
      meta="Not in the script yet · a heading with this name will point here"
      label="New location"
      route="locations"
      onClose={close}
      footer={
        <>
          <DrawerNotice notice={notice} />
          <div className="flex-1" />
          <button type="button" data-drawer-cancel disabled={busy} onClick={close} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
            Cancel
          </button>
          <button type="button" data-drawer-create disabled={busy} onClick={create} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[18px] text-12-5 font-medium">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <LocationFields draft={draft} onChange={setDraft} busy={busy} row={null} parents={parents} />
    </DrawerShell>
  )
}
