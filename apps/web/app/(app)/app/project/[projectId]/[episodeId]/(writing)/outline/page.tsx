import { OutlineRoute } from '../../../_outline/outline-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/**
 * The Outline route, episodic shape. `_outline/outline-route.tsx` is the
 * server read, `_outline/outline-workspace.tsx` the editor. The film-shaped
 * page under `(film)/` renders the same.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/[episodeId]/outline'>) => {
  const { projectId, episodeId } = await params
  const context = await enterEpisodeRoute(projectId, episodeId, 'outline')
  return <OutlineRoute context={context} searchParams={searchParams} />
}

export default Page
