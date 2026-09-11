import { ProjectRoutePage } from '../_chrome/project-route-page'

/** Empty shell this phase. See `_chrome/project-route-page.tsx`. */
const Page = (props: PageProps<'/app/project/[projectId]/research'>) => (
  <ProjectRoutePage route="research" {...props} />
)

export default Page
