import { ResearchRoute } from '../_research/research-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/**
 * `/research`. No source named: the Library grid, or the Clips list by
 * `?view=`; `?view=source` goes to the first source's own page.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/research'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <ResearchRoute context={context} searchParams={searchParams} selected={null} />
}

export default Page
