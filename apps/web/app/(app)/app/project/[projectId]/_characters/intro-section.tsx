'use client'

import type { CharacterProfile, ProjectId, SceneRef } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import Link from 'next/link'

import { citeOf } from '../../../../../../lib/characters/figures'
import { count } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { ConflictBlock } from '../_chrome/conflict-block'
import { SectionHead } from '../_chrome/drawer-parts'
import { Section } from './drawer-shell'

/**
 * `Introduced` - the action line that first names the character
 * (`findIntroductions`, phase 3), quoted with its scene chip; a ghost `Use
 * this` appends it to the Description draft (the writer saves, or not);
 * `38 on the page` beside the Age field is the same line's number. Under
 * it, when the character speaks in a scene before the one that introduces
 * them, a conflict block with no accept - `MEERA speaks in E1 Sc 2 before
 * the script introduces her.` - and `It's deliberate`, which is remembered
 * (`dismissIntroFinding`). Empty: `Not introduced in action.` with the
 * Fountain caveat, because a CAPS intro on its own line is a cue and lands
 * in the queue, never here.
 */
const PRONOUN: Readonly<Record<string, string>> = { female: 'her', male: 'him' }

export const IntroSection = ({
  projectId,
  shape,
  profile,
  refs,
  introConflict,
  busy,
  onUse,
  onDeliberate,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly profile: CharacterProfile
  readonly refs: ReadonlyMap<NodeId, SceneRef>
  /** The scene the character first speaks in before the introduction, or null. */
  readonly introConflict: SceneRef | null
  readonly busy: boolean
  readonly onUse: (text: string) => void
  readonly onDeliberate: (nodeId: NodeId) => void
}) => {
  const intro = profile.intro
  const ref = intro === null || intro.sceneNodeId === null ? undefined : refs.get(intro.sceneNodeId)
  const cite = ref === undefined ? null : citeOf(projectId, shape, ref)
  const spoke = introConflict === null ? null : citeOf(projectId, shape, introConflict)
  const pronoun = profile.gender === null ? 'them' : (PRONOUN[profile.gender] ?? 'them')
  return (
    <Section>
      <SectionHead label="Introduced">
        <span className="text-11 text-ink3">{profile.namedIn > 0 ? `${count(profile.namedIn)} action ${profile.namedIn === 1 ? 'line names' : 'lines name'} ${profile.name}` : 'from the script'}</span>
      </SectionHead>
      {intro === null ? (
        <div className="flex flex-col gap-[3px]" data-intro="none">
          <span className="text-11 text-ink3">Not introduced in action.</span>
          <span className="text-11 leading-[1.45] text-ink3">A CAPS line imported from Fountain may be waiting in the queue as a cue.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-[6px]" data-intro={intro.nodeId}>
          <span className="flex items-center gap-[6px] text-11 text-ink3">
            {cite === null ? (
              <span>the action line</span>
            ) : (
              <Link href={cite.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                {cite.label}
              </Link>
            )}
            {intro.age === null ? null : <span data-intro-age={intro.age}>· {intro.age} on the page</span>}
          </span>
          <span className="text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
            {intro.text}
          </span>
          <button
            type="button"
            data-intro-use
            disabled={busy}
            onClick={() => {
              onUse(intro.text)
            }}
            className="self-start text-11 text-ink3 hover:text-ink2 hover:underline"
          >
            Use this as the description
          </button>
          {spoke === null || introConflict === null ? null : (
            <ConflictBlock
              title={`${profile.name.toUpperCase()} speaks in ${spoke.label} before the script introduces ${pronoun}.`}
              detail="The first line comes before the action line that names them. A cold open does this on purpose; a moved scene does it by accident."
              busy={busy}
              onDeliberate={() => {
                onDeliberate(intro.nodeId)
              }}
            >
              <span className="mt-[4px] flex items-center gap-[4px]" data-intro-conflict={introConflict.sceneNodeId}>
                <Link href={spoke.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                  {spoke.label}
                </Link>
                <span className="text-10-5 text-ink3">speaks</span>
                {cite === null ? null : (
                  <>
                    <span className="text-10-5 text-ink3">·</span>
                    <Link href={cite.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
                      {cite.label}
                    </Link>
                    <span className="text-10-5 text-ink3">introduced</span>
                  </>
                )}
              </span>
            </ConflictBlock>
          )}
        </div>
      )}
    </Section>
  )
}
