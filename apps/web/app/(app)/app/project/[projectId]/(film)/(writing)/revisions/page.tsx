import { EpisodeRoutePage } from '../../../_chrome/episode-route-page'
import { RevisionsBody } from '../../../_revisions/revisions-body'
import { RevisionsHeader } from '../../../_revisions/revisions-header'

/**
 * The Revisions route, collapsed (film) shape. One implementation for both
 * `?view=` values; the header and body share one `cache()`d read.
 */
const Page = (props: PageProps<'/app/project/[projectId]/revisions'>) => (
  <EpisodeRoutePage
    route="revisions"
    {...props}
    header={(subViews, address) => <RevisionsHeader address={address} view={subViews.view} />}
    render={(subViews, address) => <RevisionsBody address={address} view={subViews.view} />}
  />
)

export default Page
