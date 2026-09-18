import { listComments, listMemberProfiles } from '@folio/db'
import { notFound } from 'next/navigation'

import type { RevisionRow, ThreadView } from '../../../../../../lib/script/panel'
import { initialsOf, whenLabel } from '../../../../../../lib/script/panel'
import { loadScript } from '../../../../../../lib/script/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import type { ScriptDraft } from './script-workspace'
import { ScriptWorkspace } from './script-workspace'

/**
 * The Script route, server side: one read, then the client workspace.
 *
 * The `<main data-route data-sub-*>` contract the smoke test reads is kept
 * exactly. The query is parsed as every route's is, and Script's schema is
 * empty (`lib/workspace/params.ts`): which document shows is client state,
 * not `?doc=`, so a switch is not a request and this component does not run
 * again for one. `empty` is not a param either: it is `loadScript` finding
 * no screenplay document.
 *
 * Threads are shaped here as the inline cards draw them - every turn, with
 * the author's name and initials - and only those anchored to a node the
 * document still has; a detached thread has nowhere to be drawn and is not.
 */
export const ScriptRoute = async ({
  context,
  searchParams,
}: {
  readonly context: EpisodeContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  if (!parseSubViews('script', await searchParams).ok) notFound()
  const { scope, project, episode, user } = context

  const load = await loadScript(scope, project, episode)

  let draft: ScriptDraft | null = null
  let unreadable: string | null = null
  if (load.state === 'draft') {
    const members = await listMemberProfiles(scope)
    const nameOf = (userId: string): string => members.find((member) => member.userId === userId)?.displayName ?? 'Someone'
    const threads: ThreadView[] = await Promise.all(
      load.threads.map(async (thread): Promise<ThreadView> => {
        const comments = await listComments(scope, thread.id)
        return {
          id: thread.id,
          nodeId: thread.anchor.kind === 'script_node' ? (thread.anchor.nodeId as string) : '',
          state: thread.state,
          turns: comments.map((comment) => {
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
        }
      }),
    )
    const revisions: RevisionRow[] = [
      ...load.revisions
        .slice()
        .reverse()
        .map((revision, index): RevisionRow => ({
          id: revision.id,
          name: `Rev. ${revision.colour.charAt(0).toUpperCase()}${revision.colour.slice(1)} — ${index === 0 && !revision.locked ? 'current' : revision.locked ? 'locked' : revision.label}`,
          meta: `${new Date(revision.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${String(revision.linesAdded + revision.linesDeleted)} edits`,
        })),
      ...load.versions
        .filter((version) => version.reason !== 'autosave')
        .map((version): RevisionRow => ({
          id: version.id,
          name:
            version.reason === 'before_import'
              ? 'Import — snapshot before'
              : version.reason === 'manual'
                ? 'Manual save'
                : version.reason === 'before_agent_run'
                  ? 'Before agent run'
                  : 'Before rename',
          meta: `${new Date(version.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${String(version.nodeCount)} nodes`,
        })),
    ]
    draft = {
      documentId: load.document.id,
      updatedAt: load.document.updatedAt,
      nodes: load.nodes,
      measurement: load.measurement,
      stats: load.stats,
      labels: load.labels,
      cues: load.cues,
      lockedPages: load.lockedPages,
      revision: episode.revisionColour,
      threads: threads.filter((thread) => thread.nodeId !== ''),
      revisions,
    }
  } else if (load.state === 'unreadable') {
    unreadable = load.detail
  }

  const colour = episode.revisionColour
  const revisionLabel = `Rev. ${colour.charAt(0).toUpperCase()}${colour.slice(1)}`

  return (
    <ScriptWorkspace
      projectId={project.id}
      episode={episode.slug}
      episodeTitle={episode.title}
      project={project}
      documentTitle={`${episode.title} · ${revisionLabel}`}
      scriptState={load.state}
      draft={draft}
      titlePage={load.state === 'unreadable' ? null : load.titlePage}
      unreadable={unreadable}
    />
  )
}
