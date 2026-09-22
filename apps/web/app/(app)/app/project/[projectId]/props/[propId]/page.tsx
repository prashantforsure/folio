import { PropIdSchema } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { PropsRoute } from '../../_props/props-route'
import { loadProject } from '../../../../../../../lib/workspace/context'

/**
 * `/props/:propId` - the record's UUID, as `/locations/:locationId` is. A
 * segment that is not a UUID is a 404 before any lookup; a UUID that names
 * no record here is a 404 inside the route.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/props/[propId]'>) => {
  const { projectId, propId } = await params
  const parsed = PropIdSchema.safeParse(propId)
  if (!parsed.success) notFound()
  const context = await loadProject(projectId)
  return <PropsRoute context={context} searchParams={searchParams} selected={parsed.data} />
}

export default Page
