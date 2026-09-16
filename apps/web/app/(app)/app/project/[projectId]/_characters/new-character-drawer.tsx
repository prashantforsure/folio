'use client'

import type { CharacterColor, ProjectId } from '@folio/contracts'
import { CHARACTER_COLORS } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { createCharacter } from '../../../../../../lib/characters/actions'
import { setNewCharacterOpen, useNewCharacterOpen } from '../../../../../../lib/characters/compose'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { DrawerShell } from './drawer-shell'
import type { ProfileDraft } from './profile-fields'
import { ProfileFields } from './profile-fields'

/**
 * `New character` - the edit drawer's shape with nothing to edit yet
 * (`Route - Characters v2.dc.html` opens the same drawer for `+`). The
 * fields, then `Cancel` / `Create`; no portrait row, no arc, no
 * relationships - a record that is not yet in the script has none. On
 * create the drawer becomes the record's own: the router goes to
 * `/characters/:id`.
 *
 * Opened through `lib/characters/compose.ts` from the sidebar's `+`, the
 * toolbar's `＋ New` and the grid's dashed card; mounted by the layout so
 * every door reaches it. The colour is the first of the ten
 * `CHARACTER_COLORS` no record uses, else the least used - the picker was
 * not carried into the v2 drawer (flagged), so the choice is made here.
 */
const EMPTY: ProfileDraft = { name: '', role: '', age: '', bio: '', status: 'draft', wants: '', needs: '' }

const pickColor = (used: readonly number[]): CharacterColor => {
  const counts = new Map<number, number>()
  for (const hue of used) counts.set(hue, (counts.get(hue) ?? 0) + 1)
  let best: (typeof CHARACTER_COLORS)[number] = CHARACTER_COLORS[0]
  let fewest = Number.POSITIVE_INFINITY
  for (const color of CHARACTER_COLORS) {
    const n = counts.get(color.hue) ?? 0
    if (n < fewest) {
      fewest = n
      best = color
    }
  }
  return best.id
}

export const NewCharacterDrawer = ({ projectId, usedHues }: { readonly projectId: ProjectId; readonly usedHues: readonly number[] }) => {
  const open = useNewCharacterOpen()
  return open ? <NewCharacterForm projectId={projectId} usedHues={usedHues} /> : null
}

const NewCharacterForm = ({ projectId, usedHues }: { readonly projectId: ProjectId; readonly usedHues: readonly number[] }) => {
  const router = useRouter()
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const close = useCallback(() => {
    setNewCharacterOpen(false)
  }, [])

  const create = (): void => {
    const name = draft.name.trim()
    if (name === '') {
      setNotice('A character needs a name.')
      return
    }
    setBusy(true)
    setNotice(null)
    void (async () => {
      const result = await createCharacter(projectId, {
        name,
        color: pickColor(usedHues),
        role: draft.role,
        age: draft.age,
        bio: draft.bio,
        status: draft.status,
        wants: draft.wants,
        needs: draft.needs,
      })
      setBusy(false)
      if (result.status !== 'created') {
        setNotice(result.message)
        return
      }
      setNewCharacterOpen(false)
      router.push(characterHref(projectId, result.id))
    })()
  }

  return (
    <DrawerShell
      title="New character"
      meta="Not in the script yet · a cue with this name will point here"
      label="New character"
      onClose={close}
      footer={
        <>
          {notice === null ? null : (
            <span className="min-w-0 flex-1 truncate text-11-5 text-live" role="alert" data-drawer-notice>
              {notice}
            </span>
          )}
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
      <ProfileFields draft={draft} onChange={setDraft} busy={busy} />
    </DrawerShell>
  )
}
