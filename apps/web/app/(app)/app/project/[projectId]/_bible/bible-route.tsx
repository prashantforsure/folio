import type { BibleEntryId, BibleEntryView, CanonConflictRow, GlossaryRow } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { loadBible, loadCanonCheck, loadEntry, loadGlossary } from '../../../../../../lib/bible/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { episodeRouteHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { BibleWorkspace } from './bible-workspace'

/**
 * The Bible route, server side: one read, then the client workspace.
 *
 * `?view=` is `entry | check | glossary` (`params.ts`), parsed as every
 * route's is; a value outside it is a 404. Which entry the entry view
 * shows is the URL: `/bible/:entryId`, or the first in nav order at
 * `/bible`. An id that names nothing here is a 404. The check and the
 * glossary read the project's nodes; they are loaded only on their view.
 *
 * The `<main data-route data-sub-view>` contract the smoke test reads is
 * kept by the workspace exactly.
 */
export const BibleRoute = async ({
  context,
  searchParams,
  selected,
}: {
  readonly context: ProjectContext
  readonly searchParams: Promise<RawSearchParams>
  readonly selected: BibleEntryId | null
}) => {
  const parsed = parseSubViews('bible', await searchParams)
  if (!parsed.ok) notFound()
  const view = parsed.params.view
  const { project, episodes, shape } = context
  const load = await loadBible(context)

  let entry: BibleEntryView | null = null
  const target = selected ?? (view === 'entry' ? (load.nav[0]?.id ?? null) : null)
  if (target !== null) {
    entry = await loadEntry(context, target)
    if (entry === null && selected !== null) notFound()
  }

  let conflicts: readonly CanonConflictRow[] | null = null
  let glossary: readonly GlossaryRow[] | null = null
  if (view === 'check') conflicts = await loadCanonCheck(context)
  if (view === 'glossary') glossary = await loadGlossary(context)

  // "Show mentions in Script →": the script of the first cited scene's
  // episode, else the first episode's.
  const firstCite = entry?.facts.flatMap((fact) => fact.cites)[0]
  const episode = episodes.find((row) => row.slug === firstCite?.episode) ?? episodes[0]
  const scriptHref =
    episode === undefined ? null : episodeRouteHref({ projectId: project.id, shape, episode: episode.slug }, 'script')

  return (
    <BibleWorkspace
      projectId={project.id}
      view={view}
      selected={selected}
      baseHref={projectRouteHref(project.id, 'bible')}
      nav={load.nav}
      counts={load.counts}
      hasPitch={load.hasPitch}
      entry={entry}
      conflicts={conflicts}
      glossary={glossary}
      sceneRefs={load.sceneRefs}
      episodes={episodes.length}
      scriptHref={scriptHref}
    />
  )
}
