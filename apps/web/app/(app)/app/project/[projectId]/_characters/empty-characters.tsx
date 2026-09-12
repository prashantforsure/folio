'use client'

import type { ProjectId } from '@folio/contracts'
import { useState } from 'react'

import { createCharacter, deriveNow } from '../../../../../../lib/characters/actions'
import { useRouter } from 'next/navigation'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { Run } from './characters-workspace'

/**
 * The empty state: no character record at all.
 *
 * `Route - Characters.dc.html`, `isEmpty`: a 460px card on `--panel` -
 * `CHARACTERS · 0`, "No characters yet", the sentence about what a record
 * is, then the two buttons. The bundle's card also lists the script's top
 * cues; that list is the output of a pass that has not run, so the card
 * here prints the count the speculative pass gives and leaves the names to
 * the pass that mints them.
 *
 * Two ways out, both real:
 *
 *   `✦ Derive N characters`  runs a project-wide pass, awaited. Derivation
 *                            runs on every save and import already, so this
 *                            state is reached only when nothing has been
 *                            written yet - or a deferred pass failed.
 *   `＋ Add by hand`          creates a record with no cue behind it.
 *
 * With nothing derivable - no script, or a script with no cue - the first
 * button is not drawn; the copy says why. Same card, both themes.
 */
export const EmptyCharacters = ({
  projectId,
  derivable,
  run,
}: {
  readonly projectId: ProjectId
  readonly derivable: number
  readonly run: Run
}) => {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const derive = (): void => {
    run(async () => {
      const result = await deriveNow(projectId)
      if (result.status !== 'derived') return result.message
      router.refresh()
      return null
    })
  }

  const add = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    run(async () => {
      const result = await createCharacter(projectId, trimmed)
      if (result.status !== 'created') return result.message
      router.push(characterHref(projectId, result.id))
      return null
    })
  }

  return (
    <div className="flex flex-1 items-center justify-center px-[24px] py-[40px]" data-empty-characters>
      <div className="flex w-full max-w-[460px] flex-col gap-[16px] rounded-chrome border border-line bg-panel px-[24px] pb-[24px] pt-[22px]">
        <div className="flex flex-col gap-[5px]">
          <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Characters · 0</span>
          <span className="font-serif text-[22px] font-medium leading-[1.15]">No characters yet</span>
          <span className="text-12 leading-[1.55] text-ink2">
            {derivable > 0
              ? `Your script has ${String(derivable)} distinct character ${derivable === 1 ? 'cue' : 'cues'}. Derive them and each becomes a record: who they are, what they want, every scene they're in, and every line they say.`
              : 'Your script has no character cues yet. Write a cue and it becomes a record: who they are, what they want, every scene they’re in, and every line they say.'}
          </span>
        </div>
        {adding ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              add()
            }}
            className="flex gap-[8px]"
          >
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
              placeholder="Character name"
              aria-label="Character name"
              className="min-w-0 flex-1 rounded-chrome border border-line2 bg-sheet px-[10px] py-[7px] text-12 text-ink outline-none placeholder:text-ink3"
            />
            <button
              type="submit"
              disabled={name.trim() === ''}
              className="rounded-chrome border-none bg-accent px-[12px] py-[8px] text-12 font-semibold text-accent-ink disabled:opacity-50"
            >
              Create
            </button>
          </form>
        ) : (
          <div className="flex gap-[8px]">
            {derivable > 0 ? (
              <button
                type="button"
                onClick={derive}
                data-derive-now
                className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border-none bg-accent px-[12px] py-[8px] text-12 font-semibold text-accent-ink hover:opacity-90"
              >
                <span aria-hidden="true" className="text-10" style={{ fontFamily: 'var(--font-glyph)' }}>
                  ✦
                </span>
                Derive {derivable} {derivable === 1 ? 'character' : 'characters'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setAdding(true)
              }}
              data-add-by-hand
              className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-line bg-transparent px-[12px] py-[8px] text-12 text-ink2 hover:bg-hover hover:text-ink"
            >
              <span aria-hidden="true" className="text-11 opacity-70" style={{ fontFamily: 'var(--font-glyph)' }}>
                ＋
              </span>
              Add by hand
            </button>
          </div>
        )}
        <span className="text-10-5 text-ink3">Cues in the script stay as written and point at the record.</span>
      </div>
    </div>
  )
}
