import { CharacterIdSchema } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { CharactersRoute } from '../../_characters/characters-route'
import { loadProject } from '../../../../../../../lib/workspace/context'

/**
 * `/characters/:characterId` - the record's UUID, as the route spec writes
 * it beside `/characters`. A segment that is not a UUID is a 404 before any
 * lookup; a UUID that names no record here is a 404 inside the route.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/characters/[characterId]'>) => {
  const { projectId, characterId } = await params
  const parsed = CharacterIdSchema.safeParse(characterId)
  if (!parsed.success) notFound()
  const context = await loadProject(projectId)
  return <CharactersRoute context={context} searchParams={searchParams} selected={parsed.data} />
}

export default Page
