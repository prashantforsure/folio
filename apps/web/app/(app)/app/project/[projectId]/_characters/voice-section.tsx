'use client'

import type { CharacterProfile, ProjectId, QuotedLine, SceneRef } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import Link from 'next/link'

import { citeOf } from '../../../../../../lib/characters/figures'
import { count } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { SectionHead } from '../_chrome/drawer-parts'
import { Section } from './drawer-shell'

/**
 * `Voice` - the drawer quotes the page (the rebuild, phase 3): the first
 * line the character speaks, the last, and the longest by words, each
 * with a linked citation chip and the line in quotes, clamped to two
 * lines; `All 412 lines →` opens the sides modal. Off the page: `Not on
 * the page yet`. Every quote is a dialogue node read by id
 * (`lib/characters/server.ts`); nothing here is summarised.
 */
const Line = ({
  label,
  line,
  detail,
  projectId,
  shape,
  refs,
}: {
  readonly label: string
  readonly line: QuotedLine | null
  readonly detail?: string
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly refs: ReadonlyMap<NodeId, SceneRef>
}) => {
  if (line === null) return null
  const ref = line.sceneNodeId === null ? undefined : refs.get(line.sceneNodeId)
  const cite = ref === undefined ? null : citeOf(projectId, shape, ref)
  return (
    <div className="flex flex-col gap-[3px]" data-voice-line={label}>
      <span className="flex items-center gap-[6px] text-11 text-ink3">
        <span>{label}</span>
        {detail === undefined ? null : <span>· {detail}</span>}
        {cite === null ? null : (
          <Link href={cite.href} data-cite-link className="folio-cite no-underline hover:border-accent hover:text-accent hover:no-underline">
            {cite.label}
          </Link>
        )}
      </span>
      <span className="line-clamp-2 text-12-5 leading-[1.5] text-ink2" style={{ textWrap: 'pretty' }}>
        “{line.text}”
      </span>
    </div>
  )
}

export const VoiceSection = ({
  projectId,
  shape,
  profile,
  refs,
  onSides,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly profile: CharacterProfile
  readonly refs: ReadonlyMap<NodeId, SceneRef>
  readonly onSides: () => void
}) => {
  const { first, last, longest } = profile.voice
  const onPage = profile.lines > 0
  return (
    <Section>
      <SectionHead label="Voice">
        <span className="text-11 text-ink3">from the script</span>
      </SectionHead>
      {!onPage || (first === null && last === null && longest === null) ? (
        <span className="text-11 text-ink3" data-voice="none">
          {onPage ? 'The lines could not be read.' : 'Not on the page yet'}
        </span>
      ) : (
        <div className="flex flex-col gap-[9px]" data-voice={profile.lines}>
          <Line label="first" line={first} projectId={projectId} shape={shape} refs={refs} />
          {last !== null && first !== null && last.nodeId === first.nodeId ? null : <Line label="last" line={last} projectId={projectId} shape={shape} refs={refs} />}
          {longest !== null && ((first !== null && longest.nodeId === first.nodeId) || (last !== null && longest.nodeId === last.nodeId)) ? null : (
            <Line
              label="longest"
              line={longest}
              {...(longest === null ? {} : { detail: `${count(longest.words)} ${longest.words === 1 ? 'word' : 'words'}` })}
              projectId={projectId}
              shape={shape}
              refs={refs}
            />
          )}
          <button type="button" data-voice-sides onClick={onSides} className="self-start text-11-5 text-accent hover:underline">
            All {count(profile.lines)} {profile.lines === 1 ? 'line' : 'lines'} →
          </button>
        </div>
      )}
    </Section>
  )
}
