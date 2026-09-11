import { listComments, listMemberProfiles } from '@folio/db'
import { notFound } from 'next/navigation'

import type { RevisionRow, ThreadCard } from '../../../../../../lib/script/panel'
import { loadScript } from '../../../../../../lib/script/server'
import { toSlateValue } from '../../../../../../lib/script/slate-model'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import type { ScriptDraft, SubViewHref } from './script-workspace'
import { ScriptWorkspace } from './script-workspace'

/**
 * The Script route, server side: one read, then the client workspace.
 *
 * Replaces `RouteShell` for this route because the Script header carries
 * the `▤ Script / ▣ Cover` segment, the save indicator, undo and the panel
 * toggle, and the route has a status bar - none of which the generic shell
 * draws. The `<main data-route data-sub-*>` contract the smoke test reads is
 * kept exactly.
 *
 * `?doc` and `?panel` are parsed and refused here as every sub-view is; an
 * unknown value is a 404. `empty` is not a param: it is `loadScript`
 * finding no screenplay document.
 */
export const ScriptRoute = async ({
  context,
  searchParams,
}: {
  readonly context: EpisodeContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  const parsed = parseSubViews('script', await searchParams)
  if (!parsed.ok) notFound()
  const { doc, panel } = parsed.params
  const { scope, project, episode, address } = context

  const load = await loadScript(scope, project, episode)

  const base = episodeRouteHref(address, 'script')
  const href = (next: { readonly doc?: 'script' | 'cover'; readonly panel?: 'info' | 'collab' }): SubViewHref => {
    const query: Record<string, string> = {}
    const d = next.doc ?? doc
    const p = next.panel ?? panel
    if (d !== 'script') query['doc'] = d
    if (p !== 'info') query['panel'] = p
    return { pathname: base, query }
  }

  let draft: ScriptDraft | null = null
  let unreadable: string | null = null
  if (load.state === 'draft') {
    const members = await listMemberProfiles(scope)
    const nameOf = (userId: string): string =>
      members.find((member) => member.userId === userId)?.displayName ?? 'Someone'
    const paged = load.measurement.ok ? load.measurement.paged : null
    const threads: ThreadCard[] = await Promise.all(
      load.threads.map(async (thread): Promise<ThreadCard> => {
        const comments = await listComments(scope, thread.id)
        const first = comments[0]
        const nodeId = thread.anchor.kind === 'script_node' ? thread.anchor.nodeId : null
        const placed = nodeId === null ? undefined : paged?.nodes.find((node) => node.id === nodeId)
        const page = placed?.runs[0]?.page
        const scene =
          nodeId === null || paged === null
            ? undefined
            : paged.scenes.find((entry) => page !== undefined && entry.startPage <= page && entry.endPage >= page)
        const when = new Date(thread.createdAt)
        const today = new Date()
        const sameDay = when.toDateString() === today.toDateString()
        return {
          id: thread.id,
          who: nameOf(thread.createdBy),
          when: sameDay
            ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          at:
            page === undefined
              ? 'detached'
              : `pg ${String(paged?.pages[page - 1]?.label ?? page)}${scene === undefined ? '' : ` · sc ${String(scene.number)}`}`,
          body: first?.body ?? '',
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
      value: toSlateValue(load.nodes),
      measurement: load.measurement,
      stats: load.stats,
      labels: load.labels,
      threads,
      revisions,
    }
  } else if (load.state === 'unreadable') {
    unreadable = load.detail
  }

  const colour = episode.revisionColour
  const revisionLabel = `Rev. ${colour.charAt(0).toUpperCase()}${colour.slice(1)}`

  return (
    <main
      data-route="script"
      data-sub-doc={doc}
      data-sub-panel={panel}
      data-script-state={load.state}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      <ScriptWorkspace
        projectId={project.id}
        episode={episode.slug}
        episodeTitle={episode.title}
        project={project}
        revisionLabel={revisionLabel}
        routeId={`${episode.slug}/script`}
        doc={doc}
        panel={panel}
        hrefs={{
          script: href({ doc: 'script' }),
          cover: href({ doc: 'cover' }),
          info: href({ panel: 'info' }),
          collab: href({ panel: 'collab' }),
        }}
        draft={draft}
        titlePage={load.state === 'unreadable' ? null : load.titlePage}
        unreadable={unreadable}
      />
    </main>
  )
}
