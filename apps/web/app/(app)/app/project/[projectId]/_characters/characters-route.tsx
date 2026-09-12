import type { CharacterProfile } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { notFound, redirect } from 'next/navigation'

import { loadCharacters, loadProfile } from '../../../../../../lib/characters/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { characterHref, episodeRouteHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { CharactersWorkspace } from './characters-workspace'

/**
 * The Characters route, server side: one read, then the client workspace.
 *
 * `?view=` is `profile | map | resolve` (`params.ts`), parsed as every
 * route's is; a value outside it is a 404. Which record the profile shows
 * is the URL: `/characters/:characterId`, or the first in nav order at
 * `/characters`. A record merged into another redirects to the survivor -
 * the loser's row is a tombstone that says where it went - and an id that
 * names nothing here is a 404.
 *
 * The `<main data-route data-sub-view>` contract the smoke test reads is
 * kept by the workspace exactly.
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
  const view = parsed.params.view
  const { project, episodes, shape } = context
  const load = await loadCharacters(context)

  let profile: CharacterProfile | null = null
  const target = selected ?? (view === 'profile' ? (load.cast[0]?.id ?? null) : null)
  if (target !== null) {
    const result = await loadProfile(context, target)
    if (result.state === 'merged') redirect(characterHref(project.id, result.into))
    if (result.state === 'missing') {
      if (selected !== null) notFound()
    } else {
      profile = result.profile
    }
  }

  const first = episodes[0]
  const address = first === undefined ? null : { projectId: project.id, shape, episode: first.slug }

  return (
    <CharactersWorkspace
      projectId={project.id}
      view={view}
      selected={selected}
      baseHref={projectRouteHref(project.id, 'characters')}
      cast={load.cast}
      resolve={load.resolve}
      map={load.map}
      cueCount={load.cueCount}
      episodes={episodes.length}
      derivable={load.derivable}
      profile={profile}
      sceneRefs={load.sceneRefs}
      links={{
        locations: projectRouteHref(project.id, 'locations'),
        bible: projectRouteHref(project.id, 'bible'),
        timeline: projectRouteHref(project.id, 'timeline'),
        insights: projectRouteHref(project.id, 'insights'),
        production: address === null ? null : episodeRouteHref(address, 'production'),
      }}
    />
  )
}
