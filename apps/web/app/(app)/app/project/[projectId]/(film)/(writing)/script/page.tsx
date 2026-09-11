import { ScriptRoute } from '../../../_script/script-route'
import { enterEpisodeRoute } from '../../../../../../../../lib/workspace/context'

/** The Script route, film shape. See the episodic page. */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/script'>) => {
  const { projectId } = await params
  const context = await enterEpisodeRoute(projectId, null, 'script')
  return <ScriptRoute context={context} searchParams={searchParams} />
}

export default Page
