import { ProductionRoute } from '../../_production/production-route'
import { enterEpisodeRoute } from '../../../../../../../lib/workspace/context'

/**
 * The Production route, episodic shape. `_production/production-route.tsx`
 * is the server read, `_production/production-workspace.tsx` the two
 * views. The film-shaped page under `(film)/` renders the same.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/[episodeId]/production'>) => {
  const { projectId, episodeId } = await params
  const context = await enterEpisodeRoute(projectId, episodeId, 'production')
  return <ProductionRoute context={context} searchParams={searchParams} />
}

export default Page
