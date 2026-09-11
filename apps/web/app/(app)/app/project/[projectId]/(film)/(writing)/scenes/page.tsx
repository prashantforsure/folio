import { EpisodeRoutePage } from '../../../_chrome/episode-route-page'
import { ScenesBody } from '../../../_scenes/scenes-body'
import { ScenesHeader } from '../../../_scenes/scenes-header'

/**
 * The Scenes route, collapsed (film) shape. One implementation for all three
 * `?view=` values; the header and body share one `cache()`d read.
 */
const Page = (props: PageProps<'/app/project/[projectId]/scenes'>) => (
  <EpisodeRoutePage
    route="scenes"
    {...props}
    header={(subViews, address) => <ScenesHeader address={address} view={subViews.view} />}
    render={(subViews, address) => <ScenesBody address={address} view={subViews.view} />}
  />
)

export default Page
