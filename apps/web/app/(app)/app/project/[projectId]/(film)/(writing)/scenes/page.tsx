import { ScenesRoute } from '../../../_scenes/scenes-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/**
 * The Scenes route, collapsed (film) shape. Same read, same views;
 * `enterEpisodeRoute` resolves the film's one episode and canonicalises the
 * URL for the project's type before anything renders.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/scenes'>) => {
  const { projectId } = await params
  const context = await enterEpisodeRoute(projectId, null, 'scenes')
  return <ScenesRoute context={context} searchParams={searchParams} />
}

export default Page
