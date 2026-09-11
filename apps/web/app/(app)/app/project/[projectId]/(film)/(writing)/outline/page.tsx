import { OutlineRoute } from '../../../_outline/outline-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/** The Outline route, film shape. See the episodic page. */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/outline'>) => {
  const { projectId } = await params
  const context = await enterEpisodeRoute(projectId, null, 'outline')
  return <OutlineRoute context={context} searchParams={searchParams} />
}

export default Page
