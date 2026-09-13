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
 * `?view=` is `overview | relationships | casting` (`params.ts`), parsed as
 * every route's is; a value outside it is a 404. `/characters/:characterId`
 * opens that record's drawer over the Overview - the id is the record's
 * UUID, so the URL survives every rename. A record merged into another
 * redirects to the survivor - the loser's row is a tombstone that says
 * where it went - and an id that names nothing here is a 404.
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
      view={selected === null ? parsed.params.view : 'overview'}
      baseHref={projectRouteHref(project.id, 'characters')}
      cast={load.cast}
      resolve={load.resolve}
      map={load.map}
      cueCount={load.cueCount}
      episodes={episodes.length}
      derivable={load.derivable}
      storage={load.storage}
      profile={profile}
    />
  )
}
