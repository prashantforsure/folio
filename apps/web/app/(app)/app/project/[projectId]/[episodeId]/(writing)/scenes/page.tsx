import { ScenesRoute } from '../../../_scenes/scenes-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/**
 * The Scenes route, episodic shape. `_scenes/scenes-route.tsx` is the
 * route's box, `_scenes/scenes-body.tsx` the read and the empty states,
 * `_scenes/scene-workspace.tsx` the three views. The film-shaped page under
 * `(film)/` renders the same.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/[episodeId]/scenes'>) => {
  const { projectId, episodeId } = await params
  const context = await enterEpisodeRoute(projectId, episodeId, 'scenes')
  return <ScenesRoute context={context} searchParams={searchParams} />
}

export default Page
