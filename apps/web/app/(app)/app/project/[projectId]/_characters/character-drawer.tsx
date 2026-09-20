'use client'

import type { CharacterProfile, ProjectId, Relationship } from '@folio/contracts'
import { CHARACTER_ORIGIN_LABELS, PORTRAIT_TYPES } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createCharacter, deleteCharacter, mergeCharacters, previewRename, removePortrait, renameCharacter, saveProfile, undoRename, uploadPortrait } from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import { leastUsedColor } from '../../../../../../lib/characters/cast'
import { relationshipOf } from '../../../../../../lib/characters/relationships'
import type { RenamePreview } from '../../../../../../lib/characters/result'
import type { UndoOffer } from '../../../../../../lib/characters/undo'
import { offerUndo } from '../../../../../../lib/characters/undo'
import { useEphemeral } from '../../../../../../lib/state/ephemeral'
import { count } from '../../../../../../lib/workspace/format'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { StatusToast } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { CastMark } from './cast-mark'
import { DrawerShell, Section } from './drawer-shell'
import type { ProfileDraft } from './profile-fields'
import { NameField, ProfileFields } from './profile-fields'
import { RenameConfirm } from './rename-confirm'

/**
 * `/characters/:characterId` - the edit drawer, a form (the fourth pass,
 * 2026-09-20, ruling 4: like laper's, fields and nothing else). Lead: the
 * portrait, or the record's gradient mark; `Edit character`; the meta
 * line `12 scenes · 40 lines · minted from the script`. Then:
 *
 *   Name              a changed name is a rename, see below
 *   Basic info        the swatches, Gender, Age, Role (`profile-fields.tsx`)
 *   Bio · Appearance notes
 *   Portrait          `Upload` / `Replace` · `Remove`; the row says why when
 *                     the `R2_*` block is unset
 *   Relationships     one row per authored relationship, read from this
 *                     record's side - `you are their sister · they are your
 *                     brother` - click to edit; `＋ Add relationship` picks
 *                     the other record and opens the modal
 *
 * Foot: `Delete` (live off the page; on the page it is drawn disabled
 * with the reason the action would refuse it - a record deleted under a
 * live cue would be minted again next pass), the notice, `Cancel`, `Save`.
 * The evidence sections, the alias table and the two ✦ model actions
 * went with the pass; aliases and merges are the queue panel's now.
 *
 * ## Save is one write; a changed name is a rename first, and a rename has an undo
 *
 * The fields are a draft until `Save`, written in one `saveProfile`. A
 * changed name is the sanctioned write-back (AGENTS.md, "Derivation is
 * one-way - except"), so the drawer asks in place with the diff
 * `previewRename` reads and runs `renameCharacter` first on yes; the result
 * carries what each cue read before, offered in the status bar as `Undo`
 * (`lib/characters/undo.ts`, `undoRename`) until another rename or the
 * route is left. `taken` - the new spelling is somebody's cue - offers the
 * merge; `Create a new character instead` keeps this record and makes a
 * new one under the typed name. This flow is kept verbatim from the
 * third pass.
 *
 * ## Focus
 *
 * On mount the drawer tells the assistant which record is open
 * (`useEphemeral().setAssistantFocus`), cleared on unmount, so the panel's
 * `focus` names this person.
 */
type Confirm = 'rename' | 'delete' | null

export const CharacterDrawer = ({
  projectId,
  figure,
  profile,
  cast,
  storage,
  baseHref,
  overlay,
  onDone,
  run,
  toast,
  onAddRelationship,
  onEditRelationship,
}: {
  readonly projectId: ProjectId
  readonly figure: CastFigure
  readonly profile: CharacterProfile
  /** Every record: the relationship picker, and the colour a `Create instead` takes. */
  readonly cast: readonly CastFigure[]
  readonly storage: boolean
  readonly baseHref: ProjectRoutePath
  /** Drawn as the floating sheet over a blurred scrim instead of docked in the route's slot - the intercepted `/characters/:id` modal. */
  readonly overlay?: boolean
  /**
   * How to leave once a close, a save or a delete succeeds. Defaults to
   * `router.push(baseHref)`, the page's own address; the intercepted modal
   * passes `router.back()` instead, so it un-pushes the entry opening it
   * added rather than pushing a further one
   * (`_characters/character-edit-modal.tsx`).
   */
  readonly onDone?: () => void
  readonly run: Run
  readonly toast: (message: string, action?: StatusToast['action']) => void
  readonly onAddRelationship: (other: CharacterId) => void
  readonly onEditRelationship: (row: Relationship) => void
}) => {
  const router = useRouter()
  const { setAssistantFocus } = useEphemeral()
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ProfileDraft>({
    name: profile.name,
    role: profile.role ?? '',
    age: profile.age ?? '',
    gender: profile.gender ?? '',
    bio: profile.bio ?? '',
    appearance: profile.appearance ?? '',
    color: profile.color,
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [preview, setPreview] = useState<RenamePreview | null>(null)
  const [picking, setPicking] = useState(false)
  const close = useCallback(() => {
    if (onDone) onDone()
    else router.push(baseHref)
  }, [baseHref, onDone, router])

  useEffect(() => {
    setAssistantFocus({ kind: 'character', id: profile.id, name: profile.name })
    return () => {
      setAssistantFocus(null)
    }
  }, [profile.id, profile.name, setAssistantFocus])

  const renamed = draft.name.trim() !== '' && draft.name.trim() !== profile.name
  const onPage = figure.appearances > 0
  const others = cast.filter((entry) => entry.id !== profile.id)
  const names = new Map(cast.map((entry) => [entry.id, entry.name]))

  const writeProfile = async (): Promise<string | null> => {
    const result = await saveProfile(projectId, profile.id, {
      color: draft.color,
      gender: draft.gender === '' ? null : draft.gender,
      role: draft.role,
      age: draft.age,
      bio: draft.bio,
      appearance: draft.appearance,
    })
    return result.status === 'saved' ? null : result.message
  }

  const openRename = (): void => {
    setConfirm('rename')
    setPreview(null)
    void previewRename(projectId, profile.id, draft.name.trim()).then(setPreview)
  }

  const offerRenameUndo = (offer: UndoOffer): void => {
    offerUndo(offer)
    toast(`Renamed ${offer.previousName.toUpperCase()} → ${offer.name} · ${count(offer.cues)} ${offer.cues === 1 ? 'cue' : 'cues'}`, {
      label: 'Undo',
      onClick: () => {
        run(async () => {
          const result = await undoRename(projectId, offer.characterId, { previousName: offer.previousName, restores: offer.restores })
          if (result.status !== 'undone') return result.message
          offerUndo(null)
          toast(
            result.skipped === 0
              ? `Rename undone · ${count(result.cues)} ${result.cues === 1 ? 'cue' : 'cues'}`
              : `Rename undone · ${count(result.cues)} of ${count(result.cues + result.skipped)} cues · ${count(result.skipped)} changed since`,
          )
          return null
        })
      },
    })
  }

  const save = (withRename: boolean): void => {
    if (draft.name.trim() === '') {
      setNotice('A character needs a name.')
      return
    }
    if (renamed && !withRename) {
      openRename()
      return
    }
    setBusy(true)
    setNotice(null)
    setConfirm(null)
    run(async () => {
      let failure: string | null = null
      let offer: UndoOffer | null = null
      if (renamed && withRename) {
        const result = await renameCharacter(projectId, profile.id, draft.name.trim())
        if (result.status === 'renamed') {
          offer = { characterId: profile.id, previousName: result.previousName, name: result.name, cues: result.cues, restores: result.restores }
        } else if (result.status === 'taken') {
          failure = `${result.cue} is already ${result.name}'s cue. Merge the two records instead.`
        } else {
          failure = result.message
        }
      }
      if (failure === null) failure = await writeProfile()
      setBusy(false)
      if (failure !== null) {
        setNotice(failure)
        return failure
      }
      if (offer !== null) offerRenameUndo(offer)
      close()
      return null
    })
  }

  /** `Create a new character instead`: this record keeps its name; the typed name becomes a new one. */
  const createInstead = (): void => {
    const name = draft.name.trim()
    setBusy(true)
    setNotice(null)
    setConfirm(null)
    run(async () => {
      const kept = await writeProfile()
      if (kept !== null) {
        setBusy(false)
        setNotice(kept)
        return kept
      }
      const result = await createCharacter(projectId, { name, color: leastUsedColor(cast.map((entry) => entry.hue)) })
      setBusy(false)
      if (result.status !== 'created') {
        setNotice(result.message)
        return result.message
      }
      toast(`Created ${name}; ${profile.name} keeps its cues.`)
      router.push(characterHref(projectId, result.id))
      return null
    })
  }

  /** The rename's `taken` door: the typed name is somebody's cue, so fold this record into theirs. */
  const merge = (into: CharacterId): void => {
    const target = cast.find((entry) => entry.id === into)
    setBusy(true)
    setNotice(null)
    setConfirm(null)
    run(async () => {
      const result = await mergeCharacters(projectId, profile.id, into)
      setBusy(false)
      if (result.status !== 'merged') {
        setNotice(result.message)
        return result.message
      }
      toast(`Merged ${profile.name} into ${target?.name ?? 'the other record'}.`)
      router.push(characterHref(projectId, result.into))
      return null
    })
  }

  const upload = (file: File): void => {
    setBusy(true)
    run(async () => {
      const form = new FormData()
      form.set('portrait', file)
      const result = await uploadPortrait(projectId, profile.id, form)
      setBusy(false)
      if (result.status !== 'saved') {
        setNotice(result.message)
        return result.message
      }
      return null
    })
  }

  const remove = (): void => {
    setBusy(true)
    run(async () => {
      const result = await removePortrait(projectId, profile.id)
      setBusy(false)
      if (result.status !== 'saved') {
        setNotice(result.message)
        return result.message
      }
      return null
    })
  }

  const destroy = (): void => {
    setBusy(true)
    setConfirm(null)
    run(async () => {
      const result = await deleteCharacter(projectId, profile.id)
      setBusy(false)
      if (result.status !== 'deleted') {
        setNotice(result.message)
        return result.message
      }
      close()
      return null
    })
  }

  const origin = profile.origin === null ? null : CHARACTER_ORIGIN_LABELS[profile.origin]
  const meta = (
    <>
      <span className="tabular" data-drawer-counts>
        {count(figure.appearances)} {figure.appearances === 1 ? 'scene' : 'scenes'} · {count(figure.lines)} {figure.lines === 1 ? 'line' : 'lines'}
      </span>
      {origin === null ? null : <span data-drawer-origin={profile.origin}>· {origin}</span>}
    </>
  )
  const rows = profile.relationships.flatMap((row) => {
    const side = relationshipOf(row, profile.id)
    return side === null ? [] : [{ row, ...side, name: names.get(side.other) ?? 'a merged record' }]
  })

  return (
    <DrawerShell
      overlay={overlay === true}
      title="Edit character"
      meta={meta}
      label={`Edit ${profile.name}`}
      lead={
        profile.portraitUrl === null ? (
          <CastMark initial={figure.initial} hue={profile.hue} size={32} radius={8} fontSize={13} />
        ) : (
          <span className="relative block h-[32px] w-[32px] overflow-hidden rounded-[8px] bg-s1" data-drawer-portrait>
            <img src={profile.portraitUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </span>
        )
      }
      onClose={close}
      footer={
        confirm === 'delete' ? (
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Delete {profile.name}? The record goes; the script is untouched.
            </span>
            <button type="button" data-delete-keep onClick={() => setConfirm(null)} className="folio-line-button h-[34px] flex-none rounded-[9px] px-[14px]">
              Keep
            </button>
            <button type="button" data-delete-confirm onClick={destroy} className="folio-line-button h-[34px] flex-none rounded-[9px] border-live px-[14px] text-live hover:border-live hover:bg-live-bg hover:text-live">
              Delete
            </button>
          </>
        ) : confirm === 'rename' ? (
          <RenameConfirm from={profile.name} to={draft.name.trim()} preview={preview} busy={busy} onConfirm={() => save(true)} onKeep={() => setConfirm(null)} onCreateInstead={createInstead} onMerge={merge} />
        ) : (
          <>
            <button
              type="button"
              data-drawer-delete
              disabled={busy || onPage}
              title={onPage ? `In ${count(figure.appearances)} ${figure.appearances === 1 ? 'scene' : 'scenes'} - remove their cues first, or merge the record from the queue.` : 'Delete this record'}
              onClick={() => setConfirm('delete')}
              className="folio-delete-button h-[34px] flex-none rounded-[9px] px-[13px] text-12-5"
            >
              Delete
            </button>
            {notice === null ? null : (
              <span className="min-w-0 flex-1 truncate text-11-5 text-live" role="alert" data-drawer-notice>
                {notice}
              </span>
            )}
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
      <ProfileFields draft={draft} onChange={setDraft} busy={busy}>
        <NameField
          value={draft.name}
          busy={busy}
          onChange={(name) => {
            setDraft((current) => ({ ...current, name }))
          }}
        />
      </ProfileFields>

      <Section gap={8}>
        <span className="folio-eyebrow">Portrait</span>
        {storage ? (
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              data-drawer-upload
              disabled={busy}
              title="A PNG, JPEG or WebP, up to 5 MB"
              onClick={() => {
                picker.current?.click()
              }}
              className="folio-line-button h-[30px] rounded-[9px] px-[12px] text-12-5"
            >
              {profile.portraitUrl === null ? 'Upload' : 'Replace'}
            </button>
            <input
              ref={picker}
              type="file"
              accept={PORTRAIT_TYPES.join(',')}
              aria-label={`Portrait for ${profile.name}`}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file !== undefined) upload(file)
              }}
            />
            <button
              type="button"
              data-drawer-remove-portrait
              disabled={busy || profile.portraitUrl === null}
              onClick={remove}
              className="folio-ghost-button h-[30px] rounded-[9px] px-[10px] text-12 text-ink3 hover:!text-ink2 disabled:cursor-default disabled:opacity-50 disabled:hover:!bg-transparent"
            >
              Remove
            </button>
          </div>
        ) : (
          <span className="text-11 text-ink3" data-drawer-storage="none">
            Portrait storage is not set up on this server yet.
          </span>
        )}
      </Section>

      <Section gap={8}>
        <div className="flex items-baseline gap-[8px]">
          <span className="folio-eyebrow flex-1">Relationships</span>
          <span className="tabular text-11 text-ink3" data-drawer-relationships={rows.length}>
            {rows.length}
          </span>
        </div>
        {rows.length === 0 ? (
          <span className="text-11 text-ink3" data-drawer-relationship="none">
            No relationships yet.
          </span>
        ) : (
          <div className="-mx-[9px] flex flex-col gap-[2px]">
            {rows.map((entry) => (
              <button
                key={entry.other}
                type="button"
                data-drawer-relationship={entry.other}
                title="Edit this relationship"
                onClick={() => {
                  onEditRelationship(entry.row)
                }}
                className="folio-ghost-button flex w-full items-center gap-[10px] rounded-[9px] px-[9px] py-[6px] text-left text-ink"
              >
                <span className="min-w-0 flex-1 truncate text-12-5">{entry.name}</span>
                <span className="min-w-0 truncate text-11 text-ink3">
                  you are their {entry.youAre === '' ? '—' : entry.youAre} · they are your {entry.theyAre === '' ? '—' : entry.theyAre}
                </span>
              </button>
            ))}
          </div>
        )}
        {picking ? (
          <div className="flex items-center gap-[8px]">
            <select
              aria-label="Add a relationship with"
              data-add-relationship-with
              defaultValue=""
              disabled={busy}
              onChange={(event) => {
                const other = event.target.value
                setPicking(false)
                if (other !== '') onAddRelationship(other as CharacterId)
              }}
              className="folio-field h-[30px] min-w-0 flex-1 rounded-[8px] py-0 text-12"
            >
              <option value="">With…</option>
              {others.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={() => setPicking(false)} className="folio-line-button h-[30px] flex-none rounded-[8px] px-[10px] text-12">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-add-relationship
            disabled={busy || others.length === 0}
            title={others.length === 0 ? 'No other character to relate to yet' : 'Add a relationship with another character'}
            onClick={() => setPicking(true)}
            className="folio-line-button h-[30px] self-start rounded-[9px] px-[12px] text-12-5 disabled:opacity-50"
          >
            ＋ Add relationship
          </button>
        )}
      </Section>
    </DrawerShell>
  )
}
