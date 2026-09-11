import { ProjectRoutePage } from '../_chrome/project-route-page'

/** Empty shell this phase. See `_chrome/project-route-page.tsx`. */
const Page = (props: PageProps<'/app/project/[projectId]/bible'>) => (
  <ProjectRoutePage route="bible" {...props} />
)

export default Page
