import { EpisodeRoutePage } from '../../../_chrome/episode-route-page'

/** Empty shell this phase, collapsed (film) shape. See `_chrome/episode-route-page.tsx`. */
const Page = (props: PageProps<'/app/project/[projectId]/script'>) => (
  <EpisodeRoutePage route="script" {...props} />
)

export default Page
