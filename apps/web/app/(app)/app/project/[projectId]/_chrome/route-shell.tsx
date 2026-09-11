import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import type { RawSearchParams, SubViews } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import type { WorkspaceRoute } from '../../../../../../lib/workspace/routes'
import { PageHeader } from '../../../../_shell/page-header'

/**
 * A route's shell: the 46px page header and a body.
 *
 * **Empty by default.** The shell-routes brief: "Chrome only - the fourteen
 * routes stay empty this phase." A route that has been built since supplies
 * `render` for its body and, when its header carries more than the title (a
 * count, view tabs), `header` in place of the plain `PageHeader`. Scenes was
 * the first to do both.
 *
 * ## Sub-views are parsed here and refused here
 *
 * `parseSubViews` applies each param's default and refuses a value that is
 * not one of the route's views. A refusal is a 404: `?view=grid` on a route
 * with no grid view is a link to a page that does not exist, and that is what
 * a 404 means. Unknown keys are ignored.
 *
 * The parsed values are written to `data-*` attributes on the `<main>` so the
 * smoke test can read a default back without a route body to look at. When a
 * body exists it reads `subViews` directly; the attributes stay because the
 * test contract grows and never rewrites.
 */
export const RouteShell = async <R extends WorkspaceRoute>({
  route,
  searchParams,
  render,
  header,
}: {
  readonly route: R
  readonly searchParams: Promise<RawSearchParams>
  /** The body, when there is one. Receives the parsed sub-views. */
  readonly render?: (subViews: SubViews<R>) => ReactNode
  /** The 46px header, when the route's has more than a title. Same geometry; use `PageHeader`. */
  readonly header?: (subViews: SubViews<R>) => ReactNode
}) => {
  const parsed = parseSubViews(route, await searchParams)
  if (!parsed.ok) notFound()

  const attributes = Object.fromEntries(
    Object.entries(parsed.params).map(([key, value]) => [`data-sub-${key}`, String(value)]),
  )

  return (
    <main
      data-route={route}
      {...attributes}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      {header === undefined ? <PageHeader title={ROUTE_TITLE[route]} /> : header(parsed.params)}
      <div className="min-h-0 flex-1 overflow-auto">{render?.(parsed.params)}</div>
    </main>
  )
}
