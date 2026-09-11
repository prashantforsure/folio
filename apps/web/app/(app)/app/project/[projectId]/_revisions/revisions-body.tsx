import Link from 'next/link'
import type { ReactNode } from 'react'

import { enterRevisions } from '../../../../../../lib/revisions/server'
import { count } from '../../../../../../lib/workspace/format'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RouteAddress } from '../_chrome/episode-route-page'
import type { RevisionsView } from './revisions-header'
import { RevisionsWorkspace } from './revisions-workspace'

/**
 * The Revisions body: one of three empty states, or the workspace.
 *
 * AGENTS.md, exception table: "Every route ships both states - no
 * exceptions." The three facts that leave nothing to draw are told apart
 * rather than collapsed:
 *
 *   no document       there is no script to issue or compare. The nav says
 *                     `empty`; here it says where to start.
 *   unreadable        a node row would not read. Reported with the reason.
 *   no revision       a script nobody has issued. Both views say so, each in
 *                     its own words, and the header's `Issue revision` is
 *                     the way out - which is why the header stays live.
 *
 * With at least one revision the workspace draws, in either view.
 */

const Empty = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
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

export const RevisionsBody = async ({
  address,
  view,
}: {
  readonly address: RouteAddress
  readonly view: RevisionsView
}) => {
  const { context, load } = await enterRevisions(address.projectId, address.segment)
  const scriptHref = episodeRouteHref(context.address, 'script')

  if (load.state === 'empty') {
    return (
      <Empty title="No script yet">
        <Copy>
          A revision is a coloured draft cut from the script. There is no script for this episode,
          so there is nothing to issue or compare yet.
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
          A node in this document does not read as a screenplay node, so no draft can be cut from
          it or compared against it. The reader refused at{' '}
          <span className="font-mono">{load.detail}</span>.
        </Copy>
      </Empty>
    )
  }

  if (load.revisions.length === 0) {
    return view === 'diff' ? (
      <Empty title="Nothing to compare yet">
        <Copy>
          This script has {count(load.nodeCount)} node{load.nodeCount === 1 ? '' : 's'} and no
          revision has been issued from it. The draft is on White pages until one is. Issue the
          first revision to fix a point to compare later work against.
        </Copy>
      </Empty>
    ) : (
      <Empty title="No drafts yet">
        <Copy>
          The history lists every revision issued for this episode &mdash; colour in sequence,
          author, note, tags, what changed, whether its pages are locked. None has been issued.
        </Copy>
      </Empty>
    )
  }

  return (
    <RevisionsWorkspace
      view={view}
      projectId={context.project.id}
      episode={context.episode.slug}
      routeTag={context.shape === 'collapsed' ? 'revisions' : `${context.episode.slug}/revisions`}
      href={episodeRouteHref(context.address, 'revisions')}
      drafts={load.drafts}
      revisions={load.revisions}
      authors={load.authors}
      initial={load.comparison}
      format={context.project.format}
    />
  )
}
