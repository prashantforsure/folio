'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'

import { deriveNow } from '../../../../../../lib/characters/actions'
import type { Run } from './characters-workspace'

/**
 * The empty state: no character record at all. A centred card in the shape
 * of the grid's - a colour tile with the person glyph, `No characters
 * yet`, one line on where records come from - and the two ways out:
 *
 *   `✦ Derive N characters`  runs a project-wide pass, awaited. Derivation
 *                            runs on every save and import already, so this
 *                            state is reached only when nothing has been
 *                            written yet - or a deferred pass failed.
 *   `＋ New Character`       the header's modal, opened from here.
 *
 * With nothing derivable - no script, or a script with no cue - the first
 * button is not drawn; the copy says why. Same card, both themes.
 */
export const EmptyCharacters = ({
  projectId,
  derivable,
  onCreate,
  run,
}: {
  readonly projectId: ProjectId
  readonly derivable: number
  readonly onCreate: () => void
  readonly run: Run
}) => {
  const router = useRouter()

  const derive = (): void => {
    run(async () => {
      const result = await deriveNow(projectId)
      if (result.status !== 'derived') return result.message
      router.refresh()
      return null
    })
  }

  return (
    <div className="flex flex-1 items-center justify-center px-[24px] py-[40px]" data-empty-characters>
      <div className="flex w-full max-w-[420px] flex-col items-center gap-[18px] rounded-card border border-line bg-panel px-[28px] pb-[28px] pt-[28px] text-center">
        <span
          aria-hidden="true"
          className="grid h-[96px] w-[72px] place-items-center rounded-[7px] text-[44px] leading-none"
          style={{ background: 'var(--chip-3)', color: 'var(--chip-ink)', fontFamily: 'var(--font-glyph)', opacity: 0.85 }}
        >
          ◍
        </span>
        <div className="flex flex-col gap-[6px]">
          <span className="font-serif text-[22px] font-medium leading-[1.15]">No characters yet</span>
          <span className="text-12 leading-[1.55] text-ink2">
            {derivable > 0
              ? `Your script has ${String(derivable)} distinct character ${derivable === 1 ? 'cue' : 'cues'}. Derive them and each becomes a card: who they are, every scene they’re in, and every line they say.`
              : 'Write a character cue in the script and it becomes a card here - or add one by hand.'}
          </span>
        </div>
        <div className="flex w-full gap-[8px]">
          {derivable > 0 ? (
            <button
              type="button"
              onClick={derive}
              data-derive-now
              className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border-none bg-accent px-[12px] py-[9px] text-12 font-semibold text-accent-ink hover:opacity-90"
            >
              <span aria-hidden="true" className="text-10" style={{ fontFamily: 'var(--font-glyph)' }}>
                ✦
              </span>
              Derive {derivable} {derivable === 1 ? 'character' : 'characters'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCreate}
            data-add-by-hand
            className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-line bg-transparent px-[12px] py-[9px] text-12 text-ink2 hover:bg-hover hover:text-ink"
          >
            <span aria-hidden="true" className="text-11 opacity-70" style={{ fontFamily: 'var(--font-glyph)' }}>
              ＋
            </span>
            New Character
          </button>
        </div>
        <span className="text-10-5 text-ink3">Cues in the script stay as written and point at the card.</span>
      </div>
    </div>
  )
}
