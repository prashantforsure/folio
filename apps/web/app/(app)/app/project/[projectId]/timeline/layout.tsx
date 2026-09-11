import { ProjectColumnLayout } from '../_chrome/project-column-layout'

/** The timeline column. See `_chrome/project-column-layout.tsx`. */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/timeline'>) => {
  const { projectId } = await params
  return (
    <ProjectColumnLayout route="timeline" projectId={projectId}>
      {children}
    </ProjectColumnLayout>
  )
}

export default Layout
