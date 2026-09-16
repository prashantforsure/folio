import { ResearchSourceIdSchema } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { ResearchRoute } from '../../_research/research-route'
import { loadProject } from '../../../../../../../lib/workspace/context'

/**
 * `/research/:sourceId` - the source's UUID, opening that source to read
 * (the mockup's `Source` view; its status bar writes `/research/<id>`). A
 * segment that is not a UUID is a 404 before any lookup; a UUID that names
 * no source here is a 404 inside the route.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/research/[sourceId]'>) => {
  const { projectId, sourceId } = await params
  const parsed = ResearchSourceIdSchema.safeParse(sourceId)
  if (!parsed.success) notFound()
  const context = await loadProject(projectId)
  return <ResearchRoute context={context} searchParams={searchParams} selected={parsed.data} />
}

export default Page
