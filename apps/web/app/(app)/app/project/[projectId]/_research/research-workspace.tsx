'use client'

import type { ProjectId, ResearchClipRow, ResearchCollectionRow, ResearchSourceRow } from '@folio/contracts'
import { useMemo, useState } from 'react'

import { useCollectionFilter } from '../../../../../../lib/research/compose'
import type { FilingTargets } from '../../../../../../lib/research/server'
import type { KindFilter } from '../../../../../../lib/research/view'
import { clipMatches, countChip, filterSources, statusLeft, statusPath } from '../../../../../../lib/research/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { useFind } from '../_chrome/find-field'
import { StatusBar } from '../_chrome/status-bar'
import { useRun } from '../_chrome/use-run'
import { ClipsView } from './clips-view'
import { EmptyResearch } from './empty-research'
import { LibraryView } from './library-view'
import { ResearchToolbar } from './research-toolbar'
import type { ResearchView } from './research-toolbar'
import { SourceView } from './source-view'

/**
 * The Research route's body inside the main-surface card - `Route -
 * Research v2.dc.html` on the shell: the toolbar (`research-toolbar.tsx`),
 * one of the three views or the empty card, and the 28px status bar
 * (`_chrome/status-bar.tsx`: `8 sources · 5 collections · 7 clips`, `Hide
 * nav`, the saved dot, `research/<id>`).
 *
 * ## `?view=` and `:sourceId` are the URL; everything else is state
 *
 * The three views are the sub-view param, so the pill's tabs are links,
 * and the source being read is the path. The type filter is component
 * state; the collection filter and the find query are cells the layout's
 * sidebar shares (`lib/research/compose.ts`, `_chrome/find-field.tsx`); the
 * drawer is another cell, mounted by the layout. None of it is worth a
 * link.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the save indicator
 * (`_chrome/use-run.ts`) is the only client-held state a write touches.
 * Nothing here computes a count the loader or `lib/research/view.ts` does
 * not.
 */
export const ResearchWorkspace = ({
  projectId,
  projectTitle,
  view,
  baseHref,
  sources,
  collections,
  clips,
  targets,
  source,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly view: ResearchView
  readonly baseHref: ProjectRoutePath
  readonly sources: readonly ResearchSourceRow[]
  readonly collections: readonly ResearchCollectionRow[]
  readonly clips: readonly ResearchClipRow[]
  readonly targets: FilingTargets
  /** The source being read, when the path names one. */
  readonly source: ResearchSourceRow | null
}) => {
  const { save, run } = useRun()
  const { query } = useFind()
  const collection = useCollectionFilter()
  const [kind, setKind] = useState<KindFilter>('all')

  const shown = useMemo(() => filterSources(sources, collection, kind, query), [collection, kind, query, sources])
  const shownClips = useMemo(() => clips.filter((clip) => clipMatches(clip, query)), [clips, query])
  const sourcesById = useMemo(() => new Map(sources.map((row) => [row.id, row])), [sources])
  const sourceClips = useMemo(() => (source === null ? [] : clips.filter((clip) => clip.sourceId === source.id)), [clips, source])

  const empty = sources.length === 0

  return (
    <main
      data-route="research"
      data-sub-view={view}
      data-research-state={empty ? 'empty' : view}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <ResearchToolbar
        chip={countChip(view, empty ? 0 : shown.length, clips.length)}
        view={view}
        baseHref={baseHref}
        kind={kind}
        onKind={setKind}
      />

      {empty ? (
        <EmptyResearch />
      ) : view === 'source' && source !== null ? (
        <SourceView projectId={projectId} source={source} clips={sourceClips} targets={targets} baseHref={baseHref} run={run} />
      ) : view === 'clips' ? (
        <ClipsView projectId={projectId} clips={shownClips} sourcesById={sourcesById} targets={targets} run={run} />
      ) : (
        <LibraryView projectId={projectId} sources={shown} selectedId={source?.id ?? null} />
      )}

      <StatusBar left={statusLeft(projectTitle, sources, collections, clips)} save={save} routeId={statusPath(view, source?.id ?? null)} />
    </main>
  )
}
