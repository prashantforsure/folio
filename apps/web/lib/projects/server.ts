import type { ProjectCard, UserId } from '@folio/contracts'
import { listProjectsFor } from '@folio/db'
import type { FolioDatabase } from '@folio/db'

import type { ProjectFilter, ProjectSort } from './view'
import { filterCounts, visibleCards } from './view'

/**
 * The Projects route's list, on the server - roadmap task 2.4, and what the
 * launcher's `list_projects` reads.
 *
 * The route reads every live project in one query and filters, counts and
 * sorts in the browser (`_projects/projects-workspace.tsx`); an agent asked
 * "which projects are archived?" had no way to ask the same question. This is
 * the same query and the same three pure functions (`lib/projects/view.ts`),
 * so a chip's count and a tool's answer cannot disagree. No project scope: a
 * project list is the one read that spans projects, and it reads only the
 * caller's own memberships (`listProjectsFor`).
 */
export type ProjectList = {
  readonly cards: readonly ProjectCard[]
  /** Every chip's count, over the whole list, as the chips print them. */
  readonly counts: Readonly<Record<ProjectFilter, number>>
}

export const readProjectList = async (
  db: FolioDatabase,
  me: UserId,
  filter: ProjectFilter,
  sort: ProjectSort,
): Promise<ProjectList> => {
  const cards = await listProjectsFor(db, me, { kind: 'all', trashed: false })
  return { cards: visibleCards(cards, filter, sort, me), counts: filterCounts(cards, me) }
}
