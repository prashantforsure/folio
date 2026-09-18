import { readRailBadges } from '@folio/db'
import type { ReactNode } from 'react'

import { assistantConnected } from '../../../../../lib/assistant/server'
import { loadProject, rememberedOrFirstEpisode } from '../../../../../lib/workspace/context'
import { ProjectShell } from './_chrome/project-shell'

/**
 * The project workspace: the shell, and a column for whatever is below.
 *
 * `docs/ui design/README.md`, "Shell": rail, sidebar, header, main surface,
 * and the panels that float over every route. This layout draws the parts
 * that are the same on every route - the rail and the assistant panel,
 * through `ProjectShell` - and the writing layout one
 * level down draws the sidebar and header for the four writing routes.
 *
 * ## What is read here, and where it comes from
 *
 * `loadProject` is the membership gate and the project row, `cache()`d so the
 * layouts and page below share one read. The badges come from
 * `readRailBadges` - `resolve_rows` in state `open`, split by subject kind -
 * and are read on every render of the layout, which is every navigation
 * inside the project, so they are never staler than the page beside them.
 *
 * The shell needs an episode to link Writing and Production to, and to open
 * the assistant on, when the URL has none (a project route). That is the
 * same "last opened, else first" the index redirect uses, from the same
 * function. Whether the assistant is connected is an environment fact
 * (`ANTHROPIC_API_KEY`), read once here and handed down as a boolean.
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
    <ProjectShell
      projectId={context.project.id}
      shape={context.shape}
      fallbackEpisode={fallback.slug}
      episodes={context.episodes.map((episode) => ({ slug: episode.slug, ordinal: episode.ordinal, title: episode.title }))}
      badges={badges}
      user={context.user}
      assistantConnected={assistantConnected()}
    >
      {children}
    </ProjectShell>
  )
}

export default ProjectLayout
