import { CharactersRoute } from '../_characters/characters-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/**
 * `/characters`. No record named, no drawer: the Overview grid, or the
 * Relationships graph or the Casting table by `?view=`.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/characters'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <CharactersRoute context={context} searchParams={searchParams} selected={null} />
}

export default Page
