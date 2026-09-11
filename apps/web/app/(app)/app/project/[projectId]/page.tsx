import { redirect } from 'next/navigation'

import { loadProject, rememberedOrFirstEpisode } from '../../../../../lib/workspace/context'
import { episodeRouteHref } from '../../../../../lib/workspace/hrefs'

/**
 * `/app/project/:projectId` → `./:episodeId/script`, last opened episode,
 * else first. For a film the episode segment is not written, so the same
 * redirect lands on `./script` - `episodeRouteHref` reads the shape.
 */
const ProjectIndex = async ({ params }: { readonly params: Promise<{ readonly projectId: string }> }) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  const episode = await rememberedOrFirstEpisode(context)
  redirect(
    episodeRouteHref(
      { projectId: context.project.id, shape: context.shape, episode: episode.slug },
      'script',
    ),
  )
}

export default ProjectIndex
