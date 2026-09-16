import { LocationsRoute } from '../_locations/locations-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/**
 * `/locations`. No record named, no drawer: the Places grid, or the Scenes
 * here list or the Sheet by `?view=`.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/locations'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <LocationsRoute context={context} searchParams={searchParams} selected={null} />
}

export default Page
