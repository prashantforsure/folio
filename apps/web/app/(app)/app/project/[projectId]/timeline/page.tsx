import { TimelineRoute } from '../_timeline/timeline-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/** `/timeline`. Project scope; the views are state, so the bare path is the whole address. */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/timeline'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <TimelineRoute context={context} searchParams={searchParams} />
}

export default Page
