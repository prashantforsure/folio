import Link from 'next/link'
import type { ReactNode } from 'react'

import { enterScenes } from '../../../../../../lib/scenes/server'
import { count } from '../../../../../../lib/workspace/format'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RouteAddress } from '../_chrome/episode-route-page'
import { SceneBoard } from './scene-board'
import type { ScenesView } from './scenes-header'
import { UnacceptedList } from './unaccepted'

/**
 * The Scenes body: one of three empty states, or the board.
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
 * Every number printed here is read: the node count is the length of the
 * node list, the scene count is the derived rows, and neither is estimated.
 */

const Empty = ({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) => (
  <div className="flex h-full min-h-[320px] items-center justify-center p-[24px]">
    <div className="flex w-full max-w-[420px] flex-col gap-[10px] rounded-chrome border border-line bg-panel p-[20px]">
      <h2 className="m-0 font-serif text-21 font-medium tracking-title">{title}</h2>
      {children}
    </div>
  </div>
)

const Copy = ({ children }: { readonly children: ReactNode }) => (
  <p className="m-0 text-11-5 leading-[1.55] text-ink2">{children}</p>
)

export const ScenesBody = async ({
  address,
  view,
}: {
  readonly address: RouteAddress
  readonly view: ScenesView
}) => {
  const { context, load } = await enterScenes(address.projectId, address.segment)
  const scriptHref = episodeRouteHref(context.address, 'script')

  if (load.state === 'empty') {
    return (
      <Empty title="No script yet">
        <Copy>
          Scenes are read from the script&rsquo;s headings. There is no script for this episode, so
          there is nothing to read yet.
        </Copy>
        <Link href={scriptHref} className="text-11-5 text-accent">
          Open the Script route to start or import one &rarr;
        </Link>
      </Empty>
    )
  }

  if (load.state === 'unreadable') {
    return (
      <Empty title="The script would not read">
        <Copy>
          A node in this document does not read as a screenplay node, so the scenes cannot be
          listed over it. The reader refused at <span className="font-mono">{load.detail}</span>.
        </Copy>
      </Empty>
    )
  }

  if (load.scenes.length === 0) {
    return (
      <Empty title="A script, but no scenes">
        <Copy>
          This script has {count(load.nodeCount)} node{load.nodeCount === 1 ? '' : 's'} and
          derivation found no scene heading it could accept. Scenes appear here as you write
          headings: <span className="font-mono">INT. MEERAS FLAT - NIGHT</span> is one;
          <span className="font-mono"> INTERCUT - PHONE CALL</span> is not, and never becomes one.
        </Copy>
        <UnacceptedList unaccepted={load.unaccepted} />
        <Link href={scriptHref} className="text-11-5 text-accent">
          Open the Script route &rarr;
        </Link>
      </Empty>
    )
  }

  return (
    <SceneBoard
      view={view}
      projectId={context.project.id}
      episode={context.episode.slug}
      routeTag={
        context.shape === 'collapsed' ? 'scenes' : `${context.episode.slug}/scenes`
      }
      productionHref={episodeRouteHref(context.address, 'production')}
      scenes={load.scenes}
      totalPages={load.measurement === null ? null : load.measurement.totalPages}
      measured={load.measurement !== null}
      stale={load.stale}
      unaccepted={load.unaccepted}
    />
  )
}
