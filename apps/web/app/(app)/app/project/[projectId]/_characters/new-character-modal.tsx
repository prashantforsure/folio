'use client'

import type { CharacterColor, ProjectId } from '@folio/contracts'
import { CHARACTER_COLORS, DEFAULT_CHARACTER_COLOR } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { createCharacter } from '../../../../../../lib/characters/actions'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { CharacterFields, emptyDraft } from './character-form'
import type { Draft } from './character-form'

/**
 * `＋ New Character`: a centred modal over a scrim - `New Character` /
 * `Create a new character with basic info`, the shared fields, `Create`.
 * One `createCharacter` call with everything typed, then the new record's
 * drawer opens. Escape and the scrim close it; a half-typed form is
 * dropped, as the reference does.
 *
 * The colour defaults to the least-used of the ten across the cast, so a
 * new person is not the same colour as the last one by default. A person
 * who never speaks has no cue to mint from, so this is AGENTS.md's "Add by
 * hand"; the name binds as the first cue, as it always did.
 */
export const NewCharacterModal = ({
  projectId,
  usedColors,
  onClose,
}: {
  readonly projectId: ProjectId
  readonly usedColors: readonly CharacterColor[]
  readonly onClose: () => void
}) => {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(leastUsed(usedColors)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const submit = async (): Promise<void> => {
    const name = draft.name.trim()
    if (name === '' || busy) return
    setBusy(true)
    setError(null)
    const result = await createCharacter(projectId, {
      name,
      color: draft.color,
      gender: draft.gender,
      age: draft.age,
      role: draft.role,
      bio: draft.bio,
      appearance: draft.appearance,
    })
    setBusy(false)
    if (result.status !== 'created') {
      setError(result.message)
      return
    }
    onClose()
    router.push(characterHref(projectId, result.id))
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-scrim px-[16px]"
      data-new-character-modal
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-character-title"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="flex max-h-[calc(100vh-48px)] w-full max-w-[680px] flex-col overflow-hidden rounded-card border border-line bg-desk shadow-[0_18px_48px_var(--scrim)]"
      >
        <header className="flex items-start gap-[12px] px-[24px] pb-[14px] pt-[22px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 id="new-character-title" className="m-0 font-serif text-21 font-medium leading-none tracking-title">
              New Character
            </h2>
            <span className="text-11-5 text-ink3">Create a new character with basic info</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-[32px] w-[32px] flex-none place-items-center rounded-full border border-line2 bg-transparent text-14 text-ink2 hover:bg-hover hover:text-ink"
          >
            ×
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-auto px-[24px] pb-[20px]">
          <CharacterFields draft={draft} onChange={setDraft} nameAutoFocus />
        </div>
        <footer className="flex items-center gap-[12px] border-t border-line px-[24px] py-[14px]">
          {error === null ? null : (
            <span className="min-w-0 flex-1 truncate text-11 text-del" role="alert">
              {error}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="submit"
            disabled={busy || draft.name.trim() === ''}
            data-create-character
            className="rounded-chrome border-none bg-accent px-[16px] py-[8px] text-12 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </form>
    </div>
  )
}

/** The colour fewest records carry; ties go to the first in the list. */
const leastUsed = (used: readonly CharacterColor[]): CharacterColor => {
  const counts = new Map<CharacterColor, number>()
  for (const color of used) counts.set(color, (counts.get(color) ?? 0) + 1)
  let best: CharacterColor = DEFAULT_CHARACTER_COLOR
  let fewest = Number.POSITIVE_INFINITY
  for (const color of CHARACTER_COLORS) {
    const count = counts.get(color.id) ?? 0
    if (count < fewest) {
      fewest = count
      best = color.id
    }
  }
  return best
}
