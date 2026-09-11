import { ProjectColumnLayout } from '../_chrome/project-column-layout'

/** The locations column. See `_chrome/project-column-layout.tsx`. */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/locations'>) => {
  const { projectId } = await params
  return (
    <ProjectColumnLayout route="locations" projectId={projectId}>
      {children}
    </ProjectColumnLayout>
  )
}

export default Layout
