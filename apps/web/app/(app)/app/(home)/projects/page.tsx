import { countProjectsFor, listProjectsFor, transactionDatabase } from '@folio/db'

import { requireUser } from '../../../../../lib/auth/session'
import { ProjectsWorkspace } from '../_projects/projects-workspace'

/**
 * `/app/projects` - every project this person belongs to, in one list.
 *
 * It was `/app/recents`, with `/app/screenwriting` and `/app/filmmaking`
 * beside it as two filtered copies; the client ruled the three into one on
 * 2026-09-22 (`handoff-account-v2/`), where the kind is a filter chip rather
 * than a route. All three old paths redirect here.
 *
 * ## One query, and everything else is a view of it
 *
 * `listProjectsFor` with `kind: 'all'` and `trashed: false` returns every live
 * project, archived ones included, with its counts, its members and the first
 * blocks of its script already read (`@folio/db`, `users.ts`). The chips, the
 * counts beside them, the sort, the grid and the list are all computed over
 * that array in `lib/projects/view.ts`, which is pure and tested. So a chip is
 * not a second query and not a query param: the URL stays `/app/projects`
 * whichever one is lit - the ruling Storyboard, Scenes, Characters, Locations
 * and the Timeline each took for their own views.
 *
 * ## Both states
 *
 * AGENTS.md, Development philosophy 4: "Both states always." Zero rows is the
 * empty state, decided by the same query that fills the grid, and it is the
 * common case for somebody who has just signed up.
 *
 * ## What the server does and what the client does
 *
 * This file reads and renders; every control below it is client state, and
 * every write is a server action in `lib/projects/actions.ts` with the
 * membership gate on it. Nothing here is interactive and nothing here ships.
 */
const ProjectsPage = async () => {
  const user = await requireUser('/app/projects')
  const db = await transactionDatabase()
  const [cards, trashed] = await Promise.all([
    listProjectsFor(db, user.id, { kind: 'all', trashed: false }),
    countProjectsFor(db, user.id, { trashed: true }),
  ])

  return (
    <ProjectsWorkspace
      cards={cards}
      me={user.id}
      trashed={trashed}
      crumbs={[`${user.displayName}’s workspace`, 'Projects']}
      now={new Date().toISOString()}
    />
  )
}

export default ProjectsPage
