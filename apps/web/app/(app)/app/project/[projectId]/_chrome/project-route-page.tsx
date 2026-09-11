import type { ReactNode } from 'react'

import { loadProject } from '../../../../../../lib/workspace/context'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import type { ProjectRoute } from '../../../../../../lib/workspace/routes'
import { RouteShell } from './route-shell'

/**
 * What every project-scoped page is. The six `page.tsx` files under the
 * project route names are each one line that names the route and hands its
 * props here. `loadProject` is the gate; it is a memo hit after the layout.
 */
export const ProjectRoutePage = async ({
  route,
  params,
  searchParams,
  render,
}: {
  readonly route: ProjectRoute
  readonly params: Promise<{ readonly projectId: string }>
  readonly searchParams: Promise<RawSearchParams>
  readonly render?: () => ReactNode
}) => {
  const { projectId } = await params
  await loadProject(projectId)
  return (
    <RouteShell
      route={route}
      searchParams={searchParams}
      {...(render === undefined ? {} : { render })}
    />
  )
}
