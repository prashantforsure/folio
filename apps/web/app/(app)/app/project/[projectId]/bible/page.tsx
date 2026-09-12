import { BibleRoute } from '../_bible/bible-route'
import { loadProject } from '../../../../../../lib/workspace/context'

/**
 * `/bible`. No entry named: the entry view shows the first in nav order;
 * the check and glossary views are project-wide and name none.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/bible'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return <BibleRoute context={context} searchParams={searchParams} selected={null} />
}

export default Page
