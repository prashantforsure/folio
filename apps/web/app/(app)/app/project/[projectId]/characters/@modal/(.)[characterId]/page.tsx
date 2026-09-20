import { CharacterIdSchema } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { CharacterEditModal } from '../../../_characters/character-edit-modal'
import { figuresOf } from '../../../../../../../../lib/characters/cast'
import { loadCharacterProfile, loadCharacters } from '../../../../../../../../lib/characters/server'
import { loadProject } from '../../../../../../../../lib/workspace/context'
import { projectRouteHref } from '../../../../../../../../lib/workspace/hrefs'

/**
 * `/characters/:characterId`, matched instead of the sibling page
 * (`../../[characterId]/page.tsx`) when the navigation to it starts from
 * `/characters` itself - Next's `(.)` intercepting convention, one level
 * inside the `@modal` parallel slot `characters/layout.tsx` now renders
 * beside `children`. Same id validation and the same merged/missing doors
 * as the full page (`loadCharacterProfile`, shared so both write it once),
 * then the same join the workspace runs (`loadCharacters` + `figuresOf`)
 * to get this record's `CastFigure` and the full cast the drawer's
 * relationship picker needs.
 *
 * Renders the edit drawer as a floating sheet over whatever is already on
 * screen (`_characters/character-edit-modal.tsx`) without touching the
 * `children` slot, so the canvas underneath keeps its viewport, its node
 * positions and its own state. A hard refresh or a deep link from another
 * route still resolves to the sibling page and gets the full workspace
 * with the drawer already open, exactly as before this file existed.
 */
const Page = async ({ params }: PageProps<'/app/project/[projectId]/characters/[characterId]'>) => {
  const { projectId, characterId } = await params
  const parsed = CharacterIdSchema.safeParse(characterId)
  if (!parsed.success) notFound()

  const context = await loadProject(projectId)
  const profile = await loadCharacterProfile(context, parsed.data)
  const load = await loadCharacters(context)
  const episodeOrdinals = context.episodes.map((episode) => episode.ordinal)
  const figures = figuresOf(load.cast, load.index, episodeOrdinals, load.relationships)
  const figure = figures.find((entry) => entry.id === profile.id)
  if (figure === undefined) notFound()

  return (
    <CharacterEditModal
      projectId={context.project.id}
      figure={figure}
      profile={profile}
      cast={figures}
      storage={load.storage}
      baseHref={projectRouteHref(context.project.id, 'characters')}
    />
  )
}

export default Page
