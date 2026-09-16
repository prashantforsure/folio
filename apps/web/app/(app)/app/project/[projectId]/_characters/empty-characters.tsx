'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'

import { deriveNow } from '../../../../../../lib/characters/actions'
import { setNewCharacterOpen } from '../../../../../../lib/characters/compose'
import type { Derivable } from '../../../../../../lib/characters/server'
import type { Run } from './characters-workspace'

/**
 * The empty state - `docs/ui design/README.md`, "Empty states": "A single
 * 440px card: heading, one paragraph of plain explanation, an accent AI
 * action plus a manual alternative, and a one-line caveat. Never an
 * illustration." `Route - Characters v2.dc.html` draws it with a mono
 * block of the three busiest cues (`MEERA · 79 scenes`, `… 8 more`),
 * `✦ Derive 11 characters` and `＋ By hand`, and the caveat `Deriving
 * costs nothing and never changes the script.`
 *
 * Every number is the speculative pass's (`loadCharacters`'s `derivable`).
 * With nothing derivable - no script, or a script with no cue - the derive
 * button is not drawn and the paragraph says why; the mono block goes too.
 */
export const EmptyCharacters = ({
  projectId,
  derivable,
  run,
}: {
  readonly projectId: ProjectId
  readonly derivable: Derivable
  readonly run: Run
}) => {
  const router = useRouter()
  const more = derivable.count - derivable.top.length

  const derive = (): void => {
    run(async () => {
      const result = await deriveNow(projectId)
      if (result.status !== 'derived') return result.message
      router.refresh()
      return null
    })
  }

  return (
    <div data-empty-characters className="flex min-h-0 flex-1 items-center justify-center px-[20px] py-[32px]">
      <div className="flex w-full max-w-[440px] flex-col gap-[16px] rounded-panel border border-line2 bg-s1 p-[24px]">
        <div className="flex flex-col gap-[7px]">
          <span className="text-17 font-medium tracking-title">No characters yet</span>
          <span className="text-13 leading-[1.55] text-ink2" style={{ textWrap: 'pretty' }}>
            {derivable.count > 0
              ? `Your script has ${String(derivable.count)} distinct character ${derivable.count === 1 ? 'cue' : 'cues'}. Derive them and each becomes a record you can edit, connect and cast.`
              : 'Write a character cue in the script and it becomes a record here - or add one by hand.'}
          </span>
        </div>
        {derivable.top.length > 0 ? (
          <div className="flex flex-col gap-[3px] rounded-[11px] border border-line2 bg-sunk px-[13px] py-[12px] font-mono text-11-5 leading-[1.6] text-ink2" data-derivable-top>
            {derivable.top.map((entry) => (
              <span key={entry.cue}>
                {entry.cue}{' '}
                <span className="text-ink3">
                  {entry.scenes} {entry.scenes === 1 ? 'scene' : 'scenes'}
                </span>
              </span>
            ))}
            {more > 0 ? <span className="text-ink3">… {more} more</span> : null}
          </div>
        ) : null}
        <div className="flex gap-[8px]">
          {derivable.count > 0 ? (
            <button type="button" onClick={derive} data-derive-now className="folio-accent-button h-[36px] flex-1 justify-center rounded-[10px] text-13">
              <span className="folio-mark">✦</span> Derive {derivable.count} {derivable.count === 1 ? 'character' : 'characters'}
            </button>
          ) : null}
          <button
            type="button"
            data-add-by-hand
            onClick={() => {
              setNewCharacterOpen(true)
            }}
            className={`folio-line-button h-[36px] justify-center rounded-[10px] px-[15px] text-13 ${derivable.count > 0 ? 'flex-none' : 'flex-1'}`}
            data-line="strong"
          >
            ＋ By hand
          </button>
        </div>
        <span className="text-11-5 text-ink3">Deriving costs nothing and never changes the script.</span>
      </div>
    </div>
  )
}
