import { BeatsRoute } from '../../../_beats/beats-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/**
 * The Beats route, episodic shape. `_beats/beats-route.tsx` is the server
 * read, `_beats/beats-workspace.tsx` the two views. The film-shaped page
 * under `(film)/` renders the same.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/[episodeId]/beats'>) => {
  const { projectId, episodeId } = await params
  const context = await enterEpisodeRoute(projectId, episodeId, 'beats')
  return <BeatsRoute context={context} searchParams={searchParams} />
}

export default Page
