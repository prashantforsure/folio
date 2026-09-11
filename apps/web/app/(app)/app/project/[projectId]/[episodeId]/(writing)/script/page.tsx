import { ScriptRoute } from '../../../_script/script-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/**
 * The Script route, episodic shape. The one route with a body this phase:
 * `_script/script-route.tsx` is the server read, `_script/script-workspace.tsx`
 * the editor. The film-shaped page under `(film)/` renders the same.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/[episodeId]/script'>) => {
  const { projectId, episodeId } = await params
  const context = await enterEpisodeRoute(projectId, episodeId, 'script')
  return <ScriptRoute context={context} searchParams={searchParams} />
}

export default Page
