import { LocationsRoute } from '../_locations/locations-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/**
 * `/locations`. No record named: the record view shows the first in tree
 * order; the breakdown and resolve views are project-wide and name none.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/locations'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <LocationsRoute context={context} searchParams={searchParams} selected={null} />
}

export default Page
