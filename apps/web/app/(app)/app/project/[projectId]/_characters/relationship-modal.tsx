'use client'

import type { ProjectId, Relationship } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { useState } from 'react'

import { deleteRelationship, saveRelationship } from '../../../../../../lib/characters/actions'
import { Field } from '../_chrome/drawer-shell'
import { Modal } from '../_chrome/modal'
import type { Run } from '../_chrome/use-run'

/**
 * `New relationship` / `Edit relationship` - the one form for an authored
 * relationship (`0024`), reached three ways: a card's connect grip dropped
 * on another card, a thread's pill or a graph label, and the drawer's
 * `＋ Add relationship`. Sub line `Relationship between Max and Roy`; two
 * labels, each side's in its own words - `Max is Roy's ___` · `Roy is
 * Max's ___` - and a description; `Delete` (an existing one only) ·
 * `Cancel` · `Create` / `Save`.
 *
 * The pair arrives in whatever order the door gave it; the action sorts
 * it and swaps the labels with it (`orderInput`), so the row's `a` is the
 * lower id whichever way the modal was opened, and an existing row reads
 * back through `relationshipOf` from `a`'s side. One label is enough; none
 * is refused by the schema and said here. Nothing re-derives: a
 * relationship is authored beside the record.
 */
export type RelationshipSide = { readonly id: CharacterId; readonly name: string }

export const RelationshipModal = ({
  projectId,
  a,
  b,
  existing,
  run,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly a: RelationshipSide
  readonly b: RelationshipSide
  /** The row as stored, when editing; null for a new one. */
  readonly existing: Relationship | null
  readonly run: Run
  readonly onClose: () => void
}) => {
  // The stored row is `aId < bId`; read it from this modal's `a`'s side.
  const fromA = existing === null ? null : existing.aId === a.id ? { aIs: existing.aIs, bIs: existing.bIs } : { aIs: existing.bIs, bIs: existing.aIs }
  const [aIs, setAIs] = useState(fromA?.aIs ?? '')
  const [bIs, setBIs] = useState(fromA?.bIs ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const save = (): void => {
    if (aIs.trim() === '' && bIs.trim() === '') {
      setNotice('Name at least one side of the relationship.')
      return
    }
    setBusy(true)
    setNotice(null)
    run(async () => {
      const result = await saveRelationship(projectId, { aId: a.id, bId: b.id, aIs, bIs, description: description.trim() === '' ? null : description })
      setBusy(false)
      if (result.status === 'error' || result.status === 'refused') {
        setNotice(result.message)
        return result.message
      }
      onClose()
      return null
    })
  }

  const destroy = (): void => {
    setBusy(true)
    setNotice(null)
    run(async () => {
      const result = await deleteRelationship(projectId, a.id, b.id)
      setBusy(false)
      if (result.status === 'error' || result.status === 'refused') {
        setNotice(result.message)
        return result.message
      }
      onClose()
      return null
    })
  }

  return (
    <Modal
      attr="data-relationship-modal"
      title={existing === null ? 'New relationship' : 'Edit relationship'}
      sub={
        <>
          Relationship between <span className="text-ink2">{a.name}</span> and <span className="text-ink2">{b.name}</span>
        </>
      }
      onClose={onClose}
      footer={
        <>
          {existing === null ? null : (
            <button type="button" data-rel-delete disabled={busy} onClick={destroy} className="folio-delete-button h-[34px] flex-none rounded-[9px] px-[13px] text-12-5">
              Delete
            </button>
          )}
          {notice === null ? null : (
            <span className="min-w-0 flex-1 truncate text-11-5 text-live" role="alert" data-modal-notice>
              {notice}
            </span>
          )}
          <div className="flex-1" />
          <button type="button" data-rel-cancel disabled={busy} onClick={onClose} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
            Cancel
          </button>
          <button type="button" data-rel-save disabled={busy} onClick={save} className="folio-solid-button h-[34px] flex-none rounded-[9px] px-[18px] text-12-5 font-medium">
            {busy ? 'Saving…' : existing === null ? 'Create' : 'Save'}
          </button>
        </>
      }
    >
      <Field label={`${a.name} is ${b.name}'s`}>
        <input
          type="text"
          value={aIs}
          disabled={busy}
          data-rel-a-is
          maxLength={40}
          placeholder="sister, rival, landlord…"
          onChange={(event) => {
            setAIs(event.target.value)
          }}
          className="folio-drawer-field"
        />
      </Field>
      <Field label={`${b.name} is ${a.name}'s`}>
        <input
          type="text"
          value={bIs}
          disabled={busy}
          data-rel-b-is
          maxLength={40}
          placeholder="brother, rival, tenant…"
          onChange={(event) => {
            setBIs(event.target.value)
          }}
          className="folio-drawer-field"
        />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          disabled={busy}
          data-rel-description
          data-kind="prose"
          rows={3}
          maxLength={500}
          placeholder="How it stands, in a line or two."
          onChange={(event) => {
            setDescription(event.target.value)
          }}
          className="folio-drawer-field text-ink2"
          style={{ textWrap: 'pretty' }}
        />
      </Field>
    </Modal>
  )
}
