'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { createProp, saveProp } from '../../../../../../lib/props/actions'
import { setNewPropOpen, useNewPropOpen } from '../../../../../../lib/props/compose'
import { propHref } from '../../../../../../lib/workspace/hrefs'
import { DrawerNotice } from '../_chrome/drawer-parts'
import { DrawerShell, Section } from '../_chrome/drawer-shell'
import type { PropDraft } from './prop-fields'
import { CategoryField, EMPTY_DRAFT, NameField, ProductionFields } from './prop-fields'

/**
 * `New prop` - the edit drawer's shape with nothing to edit yet: the name,
 * the category, then the status and description; `Cancel` / `Create`. No
 * evidence section and no alias table - a record with no id has nothing to
 * bind to. On create the drawer becomes the record's own: the router goes
 * to `/props/:id`, where the first thing the writer sees is the alias
 * table asking what the page calls it.
 *
 * Opened through `lib/props/compose.ts` from the sidebar's `+`, the
 * toolbar's `＋ New`, the grid's dashed tile and the empty card; mounted by
 * the layout so every door reaches the one drawer. `createProp` mints the
 * record with its name bound as its first spelling and the category set;
 * the status and description are one `saveProp` after it, so a record is
 * never half-made.
 */
export const NewPropDrawer = ({ projectId, categories }: { readonly projectId: ProjectId; readonly categories: readonly string[] }) => {
  const open = useNewPropOpen()
  return open ? <NewPropForm projectId={projectId} categories={categories} /> : null
}

const NewPropForm = ({ projectId, categories }: { readonly projectId: ProjectId; readonly categories: readonly string[] }) => {
  const router = useRouter()
  const [draft, setDraft] = useState<PropDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const close = useCallback(() => {
    setNewPropOpen(false)
  }, [])

  const create = (): void => {
    const name = draft.name.trim()
    if (name === '') {
      setNotice('A prop needs a name.')
      return
    }
    setBusy(true)
    setNotice(null)
    void (async () => {
      const created = await createProp(projectId, name, draft.category)
      if (created.status !== 'created') {
        setBusy(false)
        setNotice(created.message)
        return
      }
      if (draft.description.trim() !== '' || draft.status !== 'needed') {
        const saved = await saveProp(projectId, created.id, { description: draft.description, status: draft.status })
        if (saved.status !== 'saved') {
          setBusy(false)
          setNotice(saved.message)
          return
        }
      }
      setBusy(false)
      setNewPropOpen(false)
      router.push(propHref(projectId, created.id))
    })()
  }

  return (
    <DrawerShell
      title="New prop"
      meta="Not in the script yet · bind what the page calls it next"
      label="New prop"
      route="props"
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
      <div className="flex flex-col gap-[11px]">
        <NameField
          value={draft.name}
          busy={busy}
          onChange={(name) => {
            setDraft((current) => ({ ...current, name }))
          }}
        />
        <CategoryField
          value={draft.category}
          categories={categories}
          busy={busy}
          onChange={(category) => {
            setDraft((current) => ({ ...current, category }))
          }}
        />
      </div>
      <Section>
        <span className="text-11-5 text-ink2">Production</span>
        <ProductionFields draft={draft} onChange={setDraft} busy={busy} />
      </Section>
    </DrawerShell>
  )
}
