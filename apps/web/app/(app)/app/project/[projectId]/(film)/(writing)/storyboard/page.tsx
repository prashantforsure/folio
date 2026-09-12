import { StoryboardRoute } from '../../../_storyboard/storyboard-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/**
 * The Storyboard route, collapsed (film) shape. Same read, same views;
 * `enterEpisodeRoute` resolves the film's one episode and canonicalises the
 * URL for the project's type before anything renders.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/storyboard'>) => {
  const { projectId } = await params
  const context = await enterEpisodeRoute(projectId, null, 'storyboard')
  return <StoryboardRoute context={context} searchParams={searchParams} />
}

export default Page
