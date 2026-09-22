import { PropsRoute } from '../_props/props-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/** `/props`. No record named, no drawer: the Overview grid, or the List. */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/props'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <PropsRoute context={context} searchParams={searchParams} selected={null} />
}

export default Page
