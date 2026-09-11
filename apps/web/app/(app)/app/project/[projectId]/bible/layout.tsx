import { ProjectColumnLayout } from '../_chrome/project-column-layout'

/** The bible column. See `_chrome/project-column-layout.tsx`. */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/bible'>) => {
  const { projectId } = await params
  return (
    <ProjectColumnLayout route="bible" projectId={projectId}>
      {children}
    </ProjectColumnLayout>
  )
}

export default Layout
