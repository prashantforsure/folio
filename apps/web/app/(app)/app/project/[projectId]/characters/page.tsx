import { CharactersRoute } from '../_characters/characters-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/**
 * `/characters`. No record named: the profile view shows the first in nav
 * order; the map and resolve views are project-wide and name none.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/characters'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <CharactersRoute context={context} searchParams={searchParams} selected={null} />
}

export default Page
