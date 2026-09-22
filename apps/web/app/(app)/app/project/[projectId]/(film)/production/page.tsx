import { notFound } from 'next/navigation'

import { ProductionRoute } from '../../_production/production-route'
import { enterEpisodeRoute } from '../../../../../../../lib/workspace/context'
import { parseSubViews } from '../../../../../../../lib/workspace/params'

/**
 * The Production route, collapsed (film) shape. Same read, same views;
 * `enterEpisodeRoute` resolves the film's one episode and canonicalises the
 * URL for the project's type before anything renders.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/production'>) => {
  const { projectId } = await params
  const context = await enterEpisodeRoute(projectId, null, 'production')
  const views = parseSubViews('production', await searchParams)
  if (!views.ok) notFound()
  return <ProductionRoute context={context} />
}

export default Page
