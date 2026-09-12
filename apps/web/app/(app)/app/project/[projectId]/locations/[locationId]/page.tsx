import { LocationIdSchema } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { LocationsRoute } from '../../_locations/locations-route'
import { loadProject } from '../../../../../../../lib/workspace/context'

/**
 * `/locations/:locationId` - the record's UUID, as the route spec writes it
 * beside `/locations`. A segment that is not a UUID is a 404 before any
 * lookup; a UUID that names no record here is a 404 inside the route.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/locations/[locationId]'>) => {
  const { projectId, locationId } = await params
  const parsed = LocationIdSchema.safeParse(locationId)
  if (!parsed.success) notFound()
  const context = await loadProject(projectId)
  return <LocationsRoute context={context} searchParams={searchParams} selected={parsed.data} />
}

export default Page
