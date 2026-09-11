import { EpisodeRoutePage } from '../../_chrome/episode-route-page'

/** Empty shell this phase. See `_chrome/episode-route-page.tsx`. */
const Page = (props: PageProps<'/app/project/[projectId]/[episodeId]/production'>) => (
  <EpisodeRoutePage route="production" {...props} />
)

export default Page
