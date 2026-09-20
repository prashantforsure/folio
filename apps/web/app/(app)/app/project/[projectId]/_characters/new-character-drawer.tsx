'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { createCharacter } from '../../../../../../lib/characters/actions'
import { leastUsedColor } from '../../../../../../lib/characters/cast'
import { setNewCharacterOpen } from '../../../../../../lib/characters/compose'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { Run } from '../_chrome/use-run'
import { DrawerShell } from './drawer-shell'
import type { ProfileDraft } from './profile-fields'
import { NameField, ProfileFields } from './profile-fields'

/**
 * `New character` - the 400px drawer with nothing to edit yet: `Basic
 * info` (Name, the swatches - least-used colour by default - Gender, Age,
 * Role) · `Bio` · `Appearance notes`, then `Cancel` / `Create`. No
 * portrait row and no relationships: a record that does not exist yet
 * has neither. On create the drawer becomes the record's own: the router
 * goes to `/characters/:id`, and the canvas lands the new card on the
 * first free grid cell without a write (`lib/characters/canvas.ts`).
 *
 * Opened through `lib/characters/compose.ts` from the toolbar's `＋ New
 * character` and the empty card's `＋ By hand`; mounted by the workspace
 * in the one drawer slot, so it, the edit drawer and the queue panel are
 * never open at once. The write goes through the page's `run`, so the
 * status bar says `Saving…` while the record is made.
 */
export const NewCharacterDrawer = ({
  projectId,
  usedHues,
  run,
}: {
  readonly projectId: ProjectId
  readonly usedHues: readonly number[]
  readonly run: Run
}) => {
  const router = useRouter()
  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    name: '',
    role: '',
    age: '',
    gender: '',
    bio: '',
    appearance: '',
    color: leastUsedColor(usedHues),
  }))
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
    run(async () => {
      const result = await createCharacter(projectId, {
        name,
        color: draft.color,
        gender: draft.gender === '' ? null : draft.gender,
        role: draft.role,
        age: draft.age,
        bio: draft.bio,
        appearance: draft.appearance,
      })
      setBusy(false)
      if (result.status !== 'created') {
        setNotice(result.message)
        return result.message
      }
      setNewCharacterOpen(false)
      router.push(characterHref(projectId, result.id))
      return null
    })
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
      <ProfileFields draft={draft} onChange={setDraft} busy={busy}>
        <NameField
          value={draft.name}
          busy={busy}
          onChange={(name) => {
            setDraft((current) => ({ ...current, name }))
          }}
        />
      </ProfileFields>
    </DrawerShell>
  )
}
