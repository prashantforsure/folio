'use client'

import type { CastRow, CharacterProfile, ProjectId } from '@folio/contracts'
import { PORTRAIT_TYPES } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import {
  bindAlias,
  deleteCharacter,
  mergeCharacters,
  removePortrait,
  renameCharacter,
  saveProfile,
  unbindAlias,
  uploadPortrait,
} from '../../../../../../lib/characters/actions'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { CharacterFields, Panel } from './character-form'
import type { Draft } from './character-form'
import type { Run } from './characters-workspace'
import { PortraitTile } from './portrait-tile'

/**
 * `/characters/:characterId`: the edit drawer, over the grid. `Edit
 * Character` / `Modify character info and backstory`, then the portrait,
 * the shared fields, the alias table, and a footer with `Delete`, `Merge
 * into…` and `Save`.
 *
 * ## Save is one write; a changed name is a rename first
 *
 * The fields are a draft until `Save`. Save writes them in one
 * `saveProfile`. If the name changed too, that is not a profile field -
 * it is the sanctioned write-back (AGENTS.md, "Derivation is one-way -
 * except"), so the drawer asks first, in place: "Rename everywhere? N cues
 * will be rewritten across the script." Confirming runs `renameCharacter`
 * and then the profile save; cancelling keeps the old name and saves the
 * rest.
 *
 * ## What stays from the first pass, and why
 *
 * The alias table row - "Also appears in the script as" - is the mechanism
 * that makes `मीरा` and `MEERA` one person, and the only place a writer can
 * see and change it. Merge is how two records that were one person become
 * one. Delete keeps its rule: refused while the record is in the script,
 * because a record deleted under a live cue is minted again on the next
 * pass. Each is one quiet control; none is a screen.
 */
export const CharacterDrawer = ({
  projectId,
  profile,
  cast,
  storage,
  baseHref,
  run,
}: {
  readonly projectId: ProjectId
  readonly profile: CharacterProfile
  readonly cast: readonly CastRow[]
  readonly storage: boolean
  readonly baseHref: ProjectRoutePath
  readonly run: Run
}) => {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>({
    name: profile.name,
    color: profile.color,
    gender: profile.gender,
    age: profile.age ?? '',
    role: profile.role ?? '',
    bio: profile.bio ?? '',
    appearance: profile.appearance ?? '',
  })
  const [confirmRename, setConfirmRename] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [merging, setMerging] = useState(false)
  const [winner, setWinner] = useState('')
  const [aliasOpen, setAliasOpen] = useState(false)
  const [alias, setAlias] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const close = (): void => {
    router.push(baseHref)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') router.push(baseHref)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [router, baseHref])

  const nameChanged = draft.name.trim() !== '' && draft.name.trim() !== profile.name

  const writeProfile = async (): Promise<string | null> => {
    const result = await saveProfile(projectId, profile.id, {
      color: draft.color,
      gender: draft.gender,
      age: draft.age,
      role: draft.role,
      bio: draft.bio,
      appearance: draft.appearance,
    })
    return result.status === 'saved' ? null : result.message
  }

  const save = (): void => {
    if (nameChanged && !confirmRename) {
      setConfirmRename(true)
      return
    }
    setConfirmRename(false)
    run(async () => {
      if (nameChanged) {
        const renamed = await renameCharacter(projectId, profile.id, draft.name.trim())
        if (renamed.status !== 'renamed') return renamed.message
        setNotice(
          renamed.cues === 0
            ? 'Renamed. No cue carried the old name.'
            : `Renamed. ${String(renamed.cues)} ${renamed.cues === 1 ? 'cue' : 'cues'} rewritten across ${String(renamed.episodes)} ${
                renamed.episodes === 1 ? 'episode' : 'episodes'
              }.`,
        )
      }
      return writeProfile()
    })
  }

  const saveWithoutRename = (): void => {
    setConfirmRename(false)
    setDraft((state) => ({ ...state, name: profile.name }))
    run(writeProfile)
  }

  const upload = (file: File): void => {
    run(async () => {
      const form = new FormData()
      form.set('portrait', file)
      const result = await uploadPortrait(projectId, profile.id, form)
      return result.status === 'saved' ? null : result.message
    })
  }

  const bind = (): void => {
    const cue = alias.trim()
    if (cue === '') return
    setAlias('')
    setAliasOpen(false)
    run(async () => {
      const result = await bindAlias(projectId, profile.id, cue)
      return result.status === 'bound' ? null : result.message
    })
  }

  const counted = new Map(profile.cues.map((cue) => [cue.cue, cue]))
  const uncounted = profile.boundCues.filter((cue) => !counted.has(cue))

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-scrim"
      data-character-drawer={profile.id}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-character-title"
        className="flex h-full w-full max-w-[560px] flex-col border-l border-line bg-desk shadow-[0_0_48px_var(--scrim)]"
      >
        <header className="flex items-start gap-[12px] px-[24px] pb-[14px] pt-[22px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 id="edit-character-title" className="m-0 font-serif text-21 font-medium leading-none tracking-title">
              Edit Character
            </h2>
            <span className="text-11-5 text-ink3">Modify character info and backstory</span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            data-drawer-close
            className="grid h-[32px] w-[32px] flex-none place-items-center rounded-full border border-line2 bg-transparent text-14 text-ink2 hover:bg-hover hover:text-ink"
          >
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-auto px-[24px] pb-[20px]">
          {/* portrait */}
          <Panel title="Portrait">
            <div className="flex items-center gap-[14px]">
              <PortraitTile
                hue={profile.hue}
                portraitUrl={profile.portraitUrl}
                name={profile.name}
                className="h-[96px] w-[72px] flex-none rounded-[7px]"
              />
              <div className="flex flex-col gap-[6px]">
                <button
                  type="button"
                  disabled={!storage}
                  title={storage ? 'Upload a portrait' : 'Portrait storage is not set up on this server yet.'}
                  data-drawer-upload
                  onClick={() => {
                    picker.current?.click()
                  }}
                  className={SMALL}
                >
                  ⇧ Upload
                </button>
                {profile.portraitUrl === null ? null : (
                  <button
                    type="button"
                    data-drawer-remove-portrait
                    onClick={() => {
                      run(async () => {
                        const result = await removePortrait(projectId, profile.id)
                        return result.status === 'saved' ? null : result.message
                      })
                    }}
                    className={SMALL}
                  >
                    Remove
                  </button>
                )}
                <span className="text-10 text-ink3">PNG, JPEG or WebP, up to 5 MB.</span>
              </div>
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
            </div>
          </Panel>

          <CharacterFields draft={draft} onChange={setDraft} />

          {/* the alias table */}
          <Panel title="Also appears in the script as" note="Every spelling that resolves to this character. Cues stay as written.">
            <div className="flex flex-wrap items-center gap-[6px]" data-cues>
              {profile.cues.map((cue) => (
                <CueChip
                  key={cue.cue}
                  cue={cue.cue}
                  count={cue.occurrences}
                  bound={profile.boundCues.includes(cue.cue)}
                  onUnbind={() => {
                    run(async () => {
                      const result = await unbindAlias(projectId, profile.id, cue.cue)
                      return result.status === 'saved' ? null : result.message
                    })
                  }}
                />
              ))}
              {uncounted.map((cue) => (
                <CueChip
                  key={cue}
                  cue={cue}
                  count={0}
                  bound
                  onUnbind={() => {
                    run(async () => {
                      const result = await unbindAlias(projectId, profile.id, cue)
                      return result.status === 'saved' ? null : result.message
                    })
                  }}
                />
              ))}
              {aliasOpen ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    bind()
                  }}
                  className="flex items-center gap-[4px]"
                >
                  <input
                    autoFocus
                    type="text"
                    value={alias}
                    onChange={(event) => {
                      setAlias(event.target.value)
                    }}
                    onBlur={() => {
                      if (alias.trim() === '') setAliasOpen(false)
                    }}
                    placeholder="Another spelling"
                    aria-label="Another spelling"
                    data-alias-input
                    className="w-[160px] rounded-chrome border border-accent-line bg-sheet px-[8px] py-[3px] font-mono text-10-5 text-ink outline-none placeholder:text-ink3"
                  />
                  <button type="submit" className="rounded-chrome border-none bg-ink px-[8px] py-[4px] text-10-5 font-semibold text-desk">
                    Add
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAliasOpen(true)
                  }}
                  data-add-alias
                  className="rounded-chrome border border-dashed border-line bg-transparent px-[8px] py-[3px] text-10-5 text-ink3 hover:bg-hover hover:text-ink"
                >
                  ＋ add spelling
                </button>
              )}
            </div>
          </Panel>

          {notice === null ? null : (
            <span className="text-11 text-add" data-renamed>
              {notice}
            </span>
          )}
        </div>

        <footer className="flex flex-col gap-[10px] border-t border-line px-[24px] py-[14px]">
          {confirmRename ? (
            <div className="flex flex-col gap-[6px] rounded-chrome border border-note bg-note-bg px-[12px] py-[10px]" data-rename-confirm>
              <span className="font-serif text-14">
                Rename {profile.name} to {draft.name.trim()} everywhere?
              </span>
              <span className="text-11 text-ink2">
                {profile.nameCues === 0
                  ? 'No cue in the script carries this name; only the record changes.'
                  : `${String(profile.nameCues)} ${profile.nameCues === 1 ? 'cue' : 'cues'} will be rewritten across the script. Other spellings bound to this character stay as they are.`}
              </span>
              <span className="flex gap-[6px]">
                <button type="button" onClick={save} data-rename-everywhere className={PRIMARY}>
                  Rename everywhere
                </button>
                <button type="button" onClick={saveWithoutRename} className={SMALL}>
                  Keep the old name
                </button>
              </span>
            </div>
          ) : null}

          {confirmDelete ? (
            <div className="flex flex-col gap-[6px] rounded-chrome border border-del bg-del-bg px-[12px] py-[10px]">
              <span className="text-11-5 text-ink">Delete {profile.name}? The profile, portrait and aliases go with it.</span>
              <span className="flex gap-[6px]">
                <button
                  type="button"
                  data-confirm-delete
                  onClick={() => {
                    run(async () => {
                      const result = await deleteCharacter(projectId, profile.id)
                      if (result.status !== 'deleted') return result.message
                      router.push(baseHref)
                      return null
                    })
                  }}
                  className="rounded-chrome border-none bg-del px-[11px] py-[6px] text-11-5 font-semibold text-accent-ink"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false)
                  }}
                  className={SMALL}
                >
                  Keep
                </button>
              </span>
            </div>
          ) : null}

          {merging ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (winner === '') return
                run(async () => {
                  const result = await mergeCharacters(projectId, profile.id, winner)
                  if (result.status !== 'merged') return result.message
                  router.push(characterHref(projectId, result.into))
                  return null
                })
              }}
              className="flex flex-col gap-[6px] rounded-chrome border border-line2 bg-panel px-[12px] py-[10px]"
            >
              <select
                autoFocus
                value={winner}
                onChange={(event) => {
                  setWinner(event.target.value)
                }}
                aria-label="Merge into"
                data-merge-into
                className="rounded-chrome border border-line2 bg-sheet px-[8px] py-[5px] text-11-5 text-ink outline-none"
              >
                <option value="">Merge into…</option>
                {cast
                  .filter((row) => row.id !== profile.id)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
              <span className="text-10 text-ink3">
                {profile.name}’s spellings move across; this record is kept as a pointer to the other.
              </span>
              <span className="flex gap-[6px]">
                <button type="submit" disabled={winner === ''} className={PRIMARY}>
                  Merge
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMerging(false)
                  }}
                  className={SMALL}
                >
                  Cancel
                </button>
              </span>
            </form>
          ) : null}

          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              disabled={profile.presence === 'present'}
              title={
                profile.presence === 'present'
                  ? 'Still in the script. Remove the cues first, or merge the record into another.'
                  : 'Delete this character'
              }
              data-delete-button
              onClick={() => {
                setConfirmDelete(true)
              }}
              className="flex items-center gap-[6px] rounded-chrome border-none bg-del px-[14px] py-[8px] text-12 font-semibold text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span aria-hidden="true" style={{ fontFamily: 'var(--font-glyph)' }}>
                ▢
              </span>
              Delete
            </button>
            <button
              type="button"
              disabled={cast.length < 2}
              data-merge-button
              onClick={() => {
                setMerging(true)
                setWinner('')
              }}
              className="rounded-chrome border-none bg-transparent px-[8px] py-[8px] text-11-5 text-ink3 hover:text-ink disabled:opacity-40"
            >
              Merge into…
            </button>
            <div className="flex-1" />
            <button type="button" onClick={save} disabled={draft.name.trim() === ''} data-save-character className={`${PRIMARY} px-[18px] py-[8px] text-12`}>
              Save
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

const PRIMARY =
  'rounded-chrome border-none bg-accent px-[11px] py-[6px] text-11-5 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50'

const SMALL =
  'rounded-chrome border border-line2 bg-transparent px-[9px] py-[5px] text-11 text-ink2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

/** One alias-table row: Courier, the count, and `×` to unbind a bound one. */
const CueChip = ({
  cue,
  count,
  bound,
  onUnbind,
}: {
  readonly cue: string
  readonly count: number
  readonly bound: boolean
  readonly onUnbind: () => void
}) => (
  <span
    data-cue-chip={cue}
    className={`group inline-flex items-center gap-[6px] rounded-chrome border border-line2 bg-sheet px-[8px] py-[3px] font-mono text-10-5 text-ink2 ${
      count === 0 ? 'opacity-70' : ''
    }`}
  >
    {cue}
    <span className="text-ink3">× {count}</span>
    {bound ? (
      <button
        type="button"
        onClick={onUnbind}
        aria-label={`Unbind ${cue}`}
        title="This spelling no longer resolves here"
        className="hidden rounded-chrome border-none bg-transparent px-[2px] font-sans text-10 text-ink3 hover:text-del group-hover:inline"
      >
        ×
      </button>
    ) : null}
  </span>
)
