import { loadProduction } from '../../../../../../lib/production/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { ProductionWorkspace } from './production-workspace'

/**
 * The Production route box: the one server read, handed to the client
 * workspace as plain props. Both page shapes (episodic and film) mount it.
 */
export const ProductionRoute = async ({ context }: { readonly context: EpisodeContext }) => {
  const load = await loadProduction(context)
  return <ProductionWorkspace projectId={context.project.id} episode={context.episode.slug} load={load} />
}
