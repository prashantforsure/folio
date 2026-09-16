import type { CharacterProfile } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { notFound, redirect } from 'next/navigation'

import { loadCharacters, loadProfile } from '../../../../../../lib/characters/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { characterHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { CharactersWorkspace } from './characters-workspace'

/**
 * The Characters route, server side: one read, then the client workspace.
 *
 * The route has no sub-view param (`params.ts`, ruled 2026-09-16): the
 * `Cast · Relationships · Sheet` tabs are client state in the layout
 * (`view-state.tsx`) and the URL stays `/characters`. `parseSubViews` is
 * still called so unknown keys are handled as every route handles them.
 * `/characters/:characterId` opens that record's drawer over the
 * view - the id is the record's UUID, so the URL survives every rename.
 * A record merged into another redirects to the survivor - the loser's
 * row is a tombstone that says where it went - and an id that names
 * nothing here is a 404.
 *
 * `loadCharacters` is `cache()`d on the context; the layout beside this
 * page (`_chrome/characters-layout.tsx`) makes the same call for the
 * sidebar, so the two share one read per request. The `<main data-route
 * data-sub-view>` contract the smoke test reads is kept by the workspace
 * exactly.
 */
export const CharactersRoute = async ({
  context,
  searchParams,
  selected,
}: {
  readonly context: ProjectContext
  readonly searchParams: Promise<RawSearchParams>
  readonly selected: CharacterId | null
}) => {
  const parsed = parseSubViews('characters', await searchParams)
  if (!parsed.ok) notFound()
  const { project, episodes } = context
  const load = await loadCharacters(context)

  let profile: CharacterProfile | null = null
  if (selected !== null) {
    const result = await loadProfile(context, selected)
    if (result.state === 'merged') redirect(characterHref(project.id, result.into))
    if (result.state === 'missing') notFound()
    profile = result.profile
  }

  return (
    <CharactersWorkspace
      projectId={project.id}
      projectTitle={project.title}
      baseHref={projectRouteHref(project.id, 'characters')}
      cast={load.cast}
      index={load.index}
      episodeOrdinals={episodes.map((episode) => episode.ordinal)}
      resolve={load.resolve}
      map={load.map}
      derivable={load.derivable}
      storage={load.storage}
      profile={profile}
    />
  )
}
