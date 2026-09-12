import { StoryboardRoute } from '../../../_storyboard/storyboard-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/**
 * The Storyboard route, episodic shape. `_storyboard/storyboard-route.tsx`
 * is the server read, `_storyboard/storyboard-workspace.tsx` the three
 * views. The film-shaped page under `(film)/` renders the same.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/[episodeId]/storyboard'>) => {
  const { projectId, episodeId } = await params
  const context = await enterEpisodeRoute(projectId, episodeId, 'storyboard')
  return <StoryboardRoute context={context} searchParams={searchParams} />
}

export default Page
