'use client'

import type { ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'

import { createPitchEntry } from '../../../../../../lib/bible/actions'
import { bibleEntryHref } from '../../../../../../lib/workspace/hrefs'
import type { Run } from './bible-workspace'

/**
 * The empty state: no entry at all.
 *
 * `Route - Bible.dc.html`, `isEmpty`: a 460px card on `--panel` - `BIBLE ·
 * 0 ENTRIES`, "The rules of the world live here", the sentence about what a
 * rule is, then the way in.
 *
 * The bundle draws two ways in. `✦ Draft from the script` "reads 3 episodes
 * and proposes premise, rules, history and a glossary" - a model call, and
 * there is no model in this repository and no agent to make one (AGENTS.md:
 * the bible is written by the agent "only on an explicit instruction in the
 * current message", and that agent is a later phase). It is not drawn; a
 * button that cannot do what it says is a placeholder. `Start with
 * sections` is real: it creates the Pitch, so the four sections and the
 * Glossary appear in the nav with the one entry every bible opens with,
 * and `＋ Entry` in the header does the rest. Of the bundle's closing line
 * only the half that is true of what is drawn is kept: "Nothing is canon
 * until you mark it." Both flagged in the phase report. Same card, both
 * themes.
 */
export const EmptyBible = ({ projectId, run }: { readonly projectId: ProjectId; readonly run: Run }) => {
  const router = useRouter()

  const start = (): void => {
    run(async () => {
      const result = await createPitchEntry(projectId)
      if (result.status !== 'created') return result.message
      router.push(bibleEntryHref(projectId, result.id))
      return null
    })
  }

  return (
    <div className="flex flex-1 items-center justify-center px-[24px] py-[40px]" data-empty-bible>
      <div className="flex w-full max-w-[460px] flex-col gap-[16px] rounded-chrome border border-line bg-panel px-[24px] pb-[24px] pt-[22px]">
        <div className="flex flex-col gap-[5px]">
          <span className="text-9-5 font-semibold uppercase tracking-label text-ink3">Bible · 0 entries</span>
          <span className="font-serif text-[22px] font-medium leading-[1.15]">The rules of the world live here</span>
          <span className="text-12 leading-[1.55] text-ink2">
            How things work, what happened before page one, what words mean. Write a rule once, cite where the script
            establishes it, and get told when a later scene breaks it.
          </span>
        </div>
        <div className="flex gap-[8px]">
          <button
            type="button"
            onClick={start}
            data-start-with-sections
            className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-line bg-transparent px-[12px] py-[8px] text-12 text-ink2 hover:bg-hover hover:text-ink"
          >
            Start with sections
          </button>
        </div>
        <span className="text-10-5 text-ink3">Nothing is canon until you mark it.</span>
      </div>
    </div>
  )
}
