import { TimelineRoute } from '../_timeline/timeline-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/** `/timeline`. Project scope; `?view=story|chrono|continuity`. */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/timeline'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <TimelineRoute context={context} searchParams={searchParams} />
}

export default Page
