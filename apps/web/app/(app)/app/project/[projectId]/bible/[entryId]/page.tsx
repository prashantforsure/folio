import { BibleEntryIdSchema } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { BibleRoute } from '../../_bible/bible-route'
import { loadProject } from '../../../../../../../lib/workspace/context'

/**
 * `/bible/:entryId` - the entry's UUID, as the route spec writes it beside
 * `/bible`. A segment that is not a UUID is a 404 before any lookup; a UUID
 * that names no entry here is a 404 inside the route.
 */
const Page = async ({ params, searchParams }: PageProps<'/app/project/[projectId]/bible/[entryId]'>) => {
  const { projectId, entryId } = await params
  const parsed = BibleEntryIdSchema.safeParse(entryId)
  if (!parsed.success) notFound()
  const context = await loadProject(projectId)
  return <BibleRoute context={context} searchParams={searchParams} selected={parsed.data} />
}

export default Page
