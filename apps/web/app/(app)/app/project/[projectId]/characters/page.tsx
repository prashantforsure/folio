import { CharactersRoute } from '../_characters/characters-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/**
 * `/characters`. No record named, no drawer: the Cast grid, the Presence
 * grid or the Sheet - the view is client state (`_characters/view-state.tsx`),
 * so the URL stays here whichever is lit.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/characters'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <CharactersRoute context={context} searchParams={searchParams} selected={null} />
}

export default Page
