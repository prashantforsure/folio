import { EpisodeRoutePage } from '../../../_chrome/episode-route-page'

/** Empty shell this phase. See `_chrome/episode-route-page.tsx`. */
const Page = (props: PageProps<'/app/project/[projectId]/[episodeId]/storyboard'>) => (
  <EpisodeRoutePage route="storyboard" {...props} />
)

export default Page
