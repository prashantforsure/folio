import { BeatsRoute } from '../../../_beats/beats-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/** The Beats route, film shape. See the episodic page. */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/beats'>) => {
  const { projectId } = await params
  const context = await enterEpisodeRoute(projectId, null, 'beats')
  return <BeatsRoute context={context} searchParams={searchParams} />
}

export default Page
