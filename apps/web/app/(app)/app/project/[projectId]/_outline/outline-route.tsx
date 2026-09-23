import { listCommentsFor, listMemberProfiles } from '@folio/db'
import { notFound } from 'next/navigation'

import { loadOutline } from '../../../../../../lib/outline/server'
import type { RevisionRow, ThreadView } from '../../../../../../lib/script/panel'
import { initialsOf, whenLabel } from '../../../../../../lib/script/panel'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import type { OutlineDraft } from './outline-workspace'
import { OutlineWorkspace } from './outline-workspace'

/**
 * The Outline route, server side: one read, then the client workspace -
 * the body inside the surface card the writing layout draws. The `<main
 * data-route>` contract the smoke test reads is kept. Outline's sub-view
 * schema is empty (`lib/workspace/params.ts`), and `empty` is
 * `loadOutline` finding no outline document - never a param.
 *
 * Threads are shaped here as the Script shapes its own - every turn, with
 * the author's name and initials - because the same cards draw them
 * (`_script/comments/`). The `Drafts` list under the title is the manual
 * snapshots (`⌘S`), newest first; the autosave and import snapshots are
 * the undo backstop, not drafts, and are not listed.
 */
export const OutlineRoute = async ({
  context,
  searchParams,
}: {
  readonly context: EpisodeContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  if (!parseSubViews('outline', await searchParams).ok) notFound()
  const { scope, project, episode, user } = context

  const load = await loadOutline(scope, project, episode)

  let draft: OutlineDraft | null = null
  let unreadable: string | null = null
  if (load.state === 'draft') {
    const members = await listMemberProfiles(scope)
    const nameOf = (userId: string): string => members.find((member) => member.userId === userId)?.displayName ?? 'Someone'
    // One statement for every thread's comments, not one per thread: over the
    // transaction pooler each is two round trips and they cannot be pipelined.
    const commentsByThread = await listCommentsFor(
      scope,
      load.threads.map((thread) => thread.id),
    )
    const threads: ThreadView[] = load.threads.map((thread): ThreadView => ({
      id: thread.id,
      nodeId: thread.anchor.kind === 'storyboard_shot' ? '' : (thread.anchor.nodeId as string),
      state: thread.state,
      turns: (commentsByThread.get(thread.id) ?? []).map((comment) => {
        const who = nameOf(comment.authorId)
        return {
          id: comment.id,
          who,
          initials: initialsOf(who),
          when: whenLabel(comment.createdAt),
          body: comment.body,
          mine: comment.authorId === user.id,
        }
      }),
    }))
    const drafts: RevisionRow[] = load.versions
      .filter((version) => version.reason === 'manual')
      .map((version): RevisionRow => ({
        id: version.id,
        name: 'Snapshot',
        meta: `${new Date(version.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${String(version.nodeCount)} blocks`,
      }))
    draft = {
      documentId: load.document.id,
      updatedAt: load.document.updatedAt,
      createdAt: load.document.createdAt,
      nodes: load.nodes,
      labels: load.labels,
      stats: load.stats,
      threads,
      drafts,
    }
  } else if (load.state === 'unreadable') {
    unreadable = load.detail
  }

  return (
    <OutlineWorkspace
      projectId={project.id}
      episode={episode.slug}
      episodeTitle={episode.title}
      outlineState={load.state}
      draft={draft}
      unreadable={unreadable}
    />
  )
}
