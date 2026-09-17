import Link from 'next/link'
import type { ReactNode } from 'react'

import { loadScenes } from '../../../../../../lib/scenes/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { count } from '../../../../../../lib/workspace/format'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import { SceneWorkspace } from './scene-workspace'
import { UnacceptedList } from './unaccepted'

/**
 * The Scenes body: one of three empty states, or the workspace.
 *
 * AGENTS.md, exception table: "Every route ships both states - no
 * exceptions." Scenes has more than two, and the brief asks for the
 * difference to be visible: an episode with no script at all, and an episode
 * with a script that derivation found no scene in, are different facts and
 * are told apart here rather than collapsed into "nothing to show".
 *
 *   no document          `readDocumentByKind` returned null. The script says
 *                        `empty` in the nav; here it says where to start.
 *   unreadable           a node row would not read as a node. Reported with
 *                        the reason; nothing is rendered over a broken list.
 *   a script, no scenes  `nodes` rows exist and `scene_derivations` has no
 *                        present row for the document. If derivation refused
 *                        headings, they are listed *as refused*, with the
 *                        reason `readSlugline` gave - never as scenes.
 *
 * The empty states are the README's card ("a single 440px card: heading,
 * one paragraph of plain explanation, an accent AI action plus a manual
 * alternative, and a one-line caveat"), as the Storyboard draws them - with
 * the manual action alone, since there is no AI action to offer over a
 * script that does not exist.
 *
 * Every number printed here is read: the node count is the length of the
 * node list, the scene count is the derived rows, and neither is estimated.
 */

const Empty = ({
  state,
  title,
  scriptHref,
  action,
  caveat,
  children,
}: {
  readonly state: 'no-script' | 'unreadable' | 'no-scenes'
  readonly title: string
  readonly scriptHref: EpisodeRoutePath | null
  readonly action: string
  readonly caveat: string
  readonly children: ReactNode
}) => (
  <div className="flex h-full min-h-[320px] items-center justify-center px-[20px] py-[32px]" data-empty-state={state}>
    <div className="flex w-full max-w-[440px] flex-col gap-[16px] rounded-panel border border-line2 bg-s1 p-[24px]">
      <div className="flex flex-col gap-[7px]">
        <h2 className="m-0 text-17 font-medium tracking-title">{title}</h2>
        {children}
      </div>
      {scriptHref === null ? null : (
        <Link href={scriptHref} className="folio-solid-button flex h-[36px] items-center justify-center gap-[8px] rounded-[10px] text-13 font-medium no-underline hover:no-underline">
          {action}
        </Link>
      )}
      <span className="text-11-5 text-ink3">{caveat}</span>
    </div>
  </div>
)

const Copy = ({ children }: { readonly children: ReactNode }) => (
  <p className="m-0 text-13 leading-[1.55] text-ink2" style={{ textWrap: 'pretty' }}>
    {children}
  </p>
)

export const ScenesBody = async ({ context }: { readonly context: EpisodeContext }) => {
  const load = await loadScenes(context)
  const scriptHref = episodeRouteHref(context.address, 'script')

  if (load.state === 'empty') {
    return (
      <Empty state="no-script" title="No script yet" scriptHref={scriptHref} action="Open the script" caveat="Write or import a script there; the scenes read its headings.">
        <Copy>Scenes are read from the script&rsquo;s headings. There is no script for this episode, so there is nothing to read yet.</Copy>
      </Empty>
    )
  }

  if (load.state === 'unreadable') {
    return (
      <Empty state="unreadable" title="The script would not read" scriptHref={null} action="" caveat="Nothing is drawn over a node list that does not read.">
        <Copy>
          A node in this document does not read as a screenplay node, so the scenes cannot be listed over it. The reader refused at{' '}
          <span className="font-mono">{load.detail}</span>.
        </Copy>
      </Empty>
    )
  }

  if (load.scenes.length === 0) {
    return (
      <Empty state="no-scenes" title="A script, but no scenes" scriptHref={scriptHref} action="Open the script" caveat="Fix the headings there; the scenes follow the script.">
        <Copy>
          This script has {count(load.nodeCount)} node{load.nodeCount === 1 ? '' : 's'} and derivation found no scene heading it could accept. Scenes appear here as
          you write headings: <span className="font-mono">INT. MEERAS FLAT - NIGHT</span> is one;
          <span className="font-mono"> INTERCUT - PHONE CALL</span> is not, and never becomes one.
        </Copy>
        <UnacceptedList unaccepted={load.unaccepted} />
      </Empty>
    )
  }

  return (
    <SceneWorkspace
      projectId={context.project.id}
      episode={context.episode.slug}
      format={context.project.format}
      productionHref={episodeRouteHref(context.address, 'production')}
      scenes={load.scenes}
      totalPages={load.measurement === null ? null : load.measurement.totalPages}
      measured={load.measurement !== null}
      stale={load.stale}
      unaccepted={load.unaccepted}
    />
  )
}
