'use client'

import type { CharacterProfile, ProjectId } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'

import { deleteCharacter, removePortrait, renameCharacter, saveProfile, uploadPortrait } from '../../../../../../lib/characters/actions'
import type { CastFigure } from '../../../../../../lib/characters/cast'
import { formatSceneRef } from '../../../../../../lib/characters/figures'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { count } from '../../../../../../lib/workspace/format'
import { CastMark } from './cast-mark'
import type { Run } from './characters-workspace'
import { DrawerShell, Section } from './drawer-shell'
import type { ProfileDraft } from './profile-fields'
import { ProfileFields } from './profile-fields'
import { useCharactersView } from './view-state'

/**
 * `/characters/:characterId` - the edit drawer, `Route - Characters
 * v2.dc.html`: `Edit character` over `79 scenes · 412 lines · E1 Sc 1 →
 * E3 Sc 30`; the 78×98 tile with `Upload reference` / `Remove`; the
 * fields (`profile-fields.tsx`); `Arc · from the script`; `Shares scenes
 * with` and its `Relationships →`; and the foot - `Delete` left, `Cancel`
 * / `Save` right (README, "Drawer"). `Relationships →` switches the view
 * behind the drawer to the graph (`view-state.tsx`) with this record's node
 * lit; it used to link to `?view=relationships`, which also closed the
 * drawer - the view is state now and the URL does not move.
 *
 * ## What the arc is, honestly
 *
 * The mockup's arc rows are authored prose per scene ref, the last in
 * amber as "unwritten". Nothing in the model holds such text and the app
 * never invents it, so the section draws what its eyebrow claims - the
 * character's scenes from the script, ref and heading, first six and a
 * count of the rest. Citations, not prose.
 *
 * ## Save is one write; a changed name is a rename first
 *
 * The fields are a draft until `Save`, written in one `saveProfile`. A
 * changed name is not a profile field: it is the sanctioned write-back
 * (AGENTS.md, "Derivation is one-way - except"), so the drawer asks in
 * place - "Rename everywhere? N cues will be rewritten" - and runs
 * `renameCharacter` first on yes. Delete is refused by the action while
 * the record is in the script; the button says so before it is pressed.
 *
 * Gender, the colour picker, appearance notes, the alias table and merge
 * were the second pass's controls and are not in the v2 drawer; the
 * actions stay (`lib/characters/actions.ts`), the surfaces go. Flagged.
 */
export type Relation = {
  readonly id: string
  readonly short: string
  readonly initial: string
  readonly hue: number
  readonly shared: number
}

const ARC_SHOWN = 6

export const CharacterDrawer = ({
  projectId,
  figure,
  profile,
  relations,
  storage,
  baseHref,
  run,
}: {
  readonly projectId: ProjectId
  readonly figure: CastFigure
  readonly profile: CharacterProfile
  readonly relations: readonly Relation[]
  readonly storage: boolean
  readonly baseHref: ProjectRoutePath
  readonly run: Run
}) => {
  const router = useRouter()
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ProfileDraft>({
    name: profile.name,
    role: profile.role ?? '',
    age: profile.age ?? '',
    bio: profile.bio ?? '',
    status: profile.status,
    wants: profile.wants ?? '',
    needs: profile.needs ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rename' | 'delete' | null>(null)
  const { setView } = useCharactersView()
  const close = useCallback(() => {
    router.push(baseHref)
  }, [baseHref, router])

  const renamed = draft.name.trim() !== '' && draft.name.trim() !== profile.name
  const onPage = figure.appearances > 0

  const writeProfile = async (): Promise<string | null> => {
    const result = await saveProfile(projectId, profile.id, {
      role: draft.role,
      age: draft.age,
      bio: draft.bio,
      status: draft.status,
      wants: draft.wants,
      needs: draft.needs,
    })
    return result.status === 'saved' ? null : result.message
  }

  const save = (withRename: boolean): void => {
    if (draft.name.trim() === '') {
      setNotice('A character needs a name.')
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
      let failure: string | null = null
      if (renamed && withRename) {
        const result = await renameCharacter(projectId, profile.id, draft.name.trim())
        if (result.status !== 'renamed') failure = result.message
      }
      if (failure === null) failure = await writeProfile()
      setBusy(false)
      if (failure !== null) {
        setNotice(failure)
        return failure
      }
      router.push(baseHref)
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
      router.push(baseHref)
      return null
    })
  }

  const span = figure.first === null || figure.last === null ? 'not in the script' : `${formatSceneRef(figure.first)} → ${formatSceneRef(figure.last)}`
  const meta = `${count(figure.appearances)} ${figure.appearances === 1 ? 'scene' : 'scenes'} · ${count(figure.lines)} ${figure.lines === 1 ? 'line' : 'lines'} · ${span}`
  const arc = figure.refs.slice(0, ARC_SHOWN)
  const arcRest = figure.refs.length - arc.length

  return (
    <DrawerShell
      title="Edit character"
      meta={meta}
      label={`Edit ${profile.name}`}
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
          <>
            <span className="min-w-0 flex-1 text-12 leading-[1.45] text-ink2" style={{ textWrap: 'pretty' }}>
              Rename everywhere? {profile.nameCues} {profile.nameCues === 1 ? 'cue' : 'cues'} in the script will read {draft.name.trim()}.
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
              disabled={busy || onPage}
              title={onPage ? `Still in the script (${count(figure.appearances)} ${figure.appearances === 1 ? 'scene' : 'scenes'}). A record under a live cue is minted again on the next pass.` : 'Delete this record'}
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
      <div className="flex items-end gap-[12px]">
        {profile.portraitUrl === null ? (
          <CastMark initial={figure.initial} hue={figure.hue} size={{ width: 78, height: 98 }} radius={11} fontSize={26} face />
        ) : (
          <span className="relative h-[98px] w-[78px] flex-none overflow-hidden rounded-[11px]" data-drawer-portrait>
            <img src={profile.portraitUrl} alt={`${profile.name}'s reference`} className="absolute inset-0 h-full w-full object-cover" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
          <button
            type="button"
            data-drawer-upload
            disabled={busy || !storage}
            title={storage ? 'A reference image for the look sheet' : 'Portrait storage is not set up on this server yet.'}
            onClick={() => {
              picker.current?.click()
            }}
            className="folio-line-button h-[30px] justify-center rounded-[9px] text-12-5"
          >
            Upload reference
          </button>
          <input
            ref={picker}
            type="file"
            accept={PORTRAIT_TYPES.join(',')}
            aria-label={`Reference for ${profile.name}`}
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
            className="folio-ghost-button h-[30px] rounded-[9px] text-12 text-ink3 hover:!text-ink2 disabled:cursor-default disabled:opacity-50 disabled:hover:!bg-transparent"
          >
            Remove
          </button>
        </div>
      </div>

      <ProfileFields draft={draft} onChange={setDraft} busy={busy} />

      <Section>
        <div className="flex items-baseline gap-[8px]">
          <span className="flex-1 text-11-5 text-ink2">Arc</span>
          <span className="text-11 text-ink3">from the script</span>
        </div>
        {arc.length === 0 ? (
          <span className="text-11 text-ink3" data-arc="none">
            Not on the page yet
          </span>
        ) : (
          <div className="flex flex-col gap-[7px]" data-arc={figure.refs.length}>
            {arc.map((ref) => (
              <div key={ref.sceneNodeId} className="flex min-w-0 gap-[10px]">
                <span className="tabular w-[58px] flex-none pt-[2px] font-mono text-10-5 text-ink3">{formatSceneRef(ref)}</span>
                <span className="min-w-0 flex-1 truncate text-12-5 leading-[1.5] text-ink2">{ref.heading === '' ? 'No heading yet' : ref.heading}</span>
              </div>
            ))}
            {arcRest > 0 ? (
              <span className="tabular pl-[68px] text-11 text-ink3">
                + {arcRest} more {arcRest === 1 ? 'scene' : 'scenes'}
              </span>
            ) : null}
          </div>
        )}
      </Section>

      <Section>
        <div className="flex items-baseline gap-[8px]">
          <span className="flex-1 text-11-5 text-ink2">Shares scenes with</span>
          <button
            type="button"
            data-drawer-relationships
            onClick={() => {
              setView('relationships')
            }}
            className="text-11 text-accent hover:underline"
          >
            Relationships →
          </button>
        </div>
        {relations.length === 0 ? (
          <span className="text-11 text-ink3" data-relations="none">
            {onPage ? 'Alone in every scene.' : 'Not on the page yet'}
          </span>
        ) : (
          <div className="-mx-[9px] flex flex-col gap-[2px]" data-relations={relations.length}>
            {relations.map((relation) => (
              <Link
                key={relation.id}
                href={characterHref(projectId, relation.id)}
                data-relation={relation.id}
                className="folio-ghost-button flex w-full items-center gap-[10px] rounded-[9px] px-[9px] py-[7px] text-left text-ink"
              >
                <CastMark initial={relation.initial} hue={relation.hue} size={22} radius={7} fontSize={9} />
                <span className="min-w-0 flex-1 truncate text-12-5">{relation.short}</span>
                <span className="tabular flex-none font-mono text-10-5 text-ink3">{relation.shared} sc</span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </DrawerShell>
  )
}
