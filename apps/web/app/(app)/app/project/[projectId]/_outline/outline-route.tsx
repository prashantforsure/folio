import { listComments, listMemberProfiles } from '@folio/db'
import { notFound } from 'next/navigation'

import { loadOutline } from '../../../../../../lib/outline/server'
import { toSlateValue } from '../../../../../../lib/outline/slate-model'
import type { RevisionRow, ThreadCard } from '../../../../../../lib/script/panel'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import type { OutlineDraft } from './outline-workspace'
import { OutlineWorkspace } from './outline-workspace'

/**
 * The Outline route, server side: one read, then the client workspace.
 *
 * Replaces `RouteShell` for this route as the Script does: the header
 * carries the save indicator and the panel toggle, and the route has a
 * status bar. The `<main data-route>` contract the smoke test reads is
 * kept. Outline's sub-view schema is empty (`lib/workspace/params.ts`), and
 * `empty` is `loadOutline` finding no outline document - never a param.
 */
export const OutlineRoute = async ({
  context,
  searchParams,
}: {
  readonly context: EpisodeContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  if (!parseSubViews('outline', await searchParams).ok) notFound()
  const { scope, project, episode, shape } = context

  const load = await loadOutline(scope, project, episode)

  let draft: OutlineDraft | null = null
  let unreadable: string | null = null
  if (load.state === 'draft') {
    const members = await listMemberProfiles(scope)
    const nameOf = (userId: string): string => members.find((member) => member.userId === userId)?.displayName ?? 'Someone'
    const threads: ThreadCard[] = await Promise.all(
      load.threads.map(async (thread): Promise<ThreadCard> => {
        const comments = await listComments(scope, thread.id)
        const when = new Date(thread.createdAt)
        const sameDay = when.toDateString() === new Date().toDateString()
        const anchor = thread.anchor
        const anchored =
          anchor.kind === 'script_node' || anchor.kind === 'storyboard_shot'
            ? null
            : load.nodes.find((node) => node.id === anchor.nodeId)
        return {
          id: thread.id,
          who: nameOf(thread.createdBy),
          when: sameDay
            ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          at: anchored === undefined || anchored === null ? 'detached' : anchored.type === 'beat' ? 'beat' : anchored.type,
          body: comments[0]?.body ?? '',
        }
      }),
    )
    const history: RevisionRow[] = load.versions.map((version): RevisionRow => ({
      id: version.id,
      name:
        version.reason === 'manual'
          ? 'Snapshot'
          : version.reason === 'before_import'
            ? 'Import — snapshot before'
            : version.reason === 'before_agent_run'
              ? 'Before agent run'
              : version.reason === 'autosave'
                ? 'Autosave'
                : version.reason,
      meta: `${new Date(version.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${String(version.nodeCount)} blocks`,
    }))
    draft = {
      documentId: load.document.id,
      updatedAt: load.document.updatedAt,
      createdAt: load.document.createdAt,
      nodes: load.nodes,
      value: toSlateValue(load.nodes),
      labels: load.labels,
      stats: load.stats,
      threads,
      history,
    }
  } else if (load.state === 'unreadable') {
    unreadable = load.detail
  }

  return (
    <OutlineWorkspace
      projectId={project.id}
      episode={episode.slug}
      episodeTitle={episode.title}
      project={project}
      routeId={shape === 'collapsed' ? 'outline' : `${episode.slug}/outline`}
      outlineState={load.state}
      draft={draft}
      unreadable={unreadable}
    />
  )
}
