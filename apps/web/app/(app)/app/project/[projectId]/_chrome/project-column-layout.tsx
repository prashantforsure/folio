import type { ReactNode } from 'react'

import { loadProject } from '../../../../../../lib/workspace/context'
import type { ProjectRoute } from '../../../../../../lib/workspace/routes'
import { ContextColumn } from './context-column'

/**
 * The find-input placeholders, transcribed from each bundle's context panel.
 * Timeline has no find input: its column is a filter column (threads and
 * anchors, later), and Insights has no column at all in this phase.
 */
const FIND: Partial<Record<ProjectRoute, string>> = {
  characters: 'Find a character',
  locations: 'Find a location or slugline',
  bible: 'Search the bible',
  research: 'Search sources and clips',
}

/**
 * A project route's column beside its page. Characters, Locations, Bible and
 * Research get a record list column; Timeline gets its filter column. Each
 * route's `layout.tsx` is one line naming itself here.
 */
export const ProjectColumnLayout = async ({
  route,
  projectId,
  children,
}: {
  readonly route: Exclude<ProjectRoute, 'insights'>
  readonly projectId: string
  readonly children: ReactNode
}) => {
  const context = await loadProject(projectId)
  const find = FIND[route]
  return (
    <>
      <ContextColumn
        route={route}
        title={context.project.title}
        {...(find === undefined ? {} : { find })}
      />
      {children}
    </>
  )
}
