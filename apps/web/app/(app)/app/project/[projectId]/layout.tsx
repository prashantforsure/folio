import { readRailBadges } from '@folio/db'
import type { ReactNode } from 'react'

import { loadProject, rememberedOrFirstEpisode } from '../../../../../lib/workspace/context'
import { projectInitials } from '../../../../../lib/workspace/format'
import { Rail } from './_chrome/rail'

/**
 * The project workspace: the rail, and a column for whatever is below.
 *
 * AGENTS.md, Architecture: "`app/(app)/project/` Project workspace: rail,
 * episode nav, the fourteen routes." This layout is the rail. The episode nav
 * is `[episodeId]/(writing)/layout.tsx` (and its film-shaped twin under
 * `(film)/`), and each project route with a record list or filter column
 * draws it in its own layout.
 *
 * ## What is read here, and where it comes from
 *
 * `loadProject` is the membership gate and the project row, `cache()`d so the
 * layouts and page below share one read. The badges come from
 * `readRailBadges` - `resolve_rows` in state `open`, split by subject kind,
 * and the bible's honest zero - and are read on every render of the layout,
 * which is every navigation inside the project, so they are never staler
 * than the page beside them.
 *
 * The rail needs an episode to link Writing and Production to when the URL
 * has none (a project route). That is the same "last opened, else first"
 * the index redirect uses, from the same function.
 */
const ProjectLayout = async ({
  children,
  params,
}: {
  readonly children: ReactNode
  readonly params: Promise<{ readonly projectId: string }>
}) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  const [badges, fallback] = await Promise.all([
    readRailBadges(context.scope),
    rememberedOrFirstEpisode(context),
  ])

  return (
    <>
      <Rail
        projectId={context.project.id}
        initials={projectInitials(context.project.title)}
        title={context.project.title}
        shape={context.shape}
        fallbackEpisode={fallback.slug}
        badges={badges}
        user={context.user}
      />
      <div className="flex min-w-0 flex-1 overflow-hidden">{children}</div>
    </>
  )
}

export default ProjectLayout
