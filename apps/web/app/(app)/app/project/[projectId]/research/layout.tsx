import { ProjectColumnLayout } from '../_chrome/project-column-layout'

/** The research column. See `_chrome/project-column-layout.tsx`. */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/research'>) => {
  const { projectId } = await params
  return (
    <ProjectColumnLayout route="research" projectId={projectId}>
      {children}
    </ProjectColumnLayout>
  )
}

export default Layout
