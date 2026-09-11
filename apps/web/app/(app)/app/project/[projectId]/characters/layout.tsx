import { ProjectColumnLayout } from '../_chrome/project-column-layout'

/** The characters column. See `_chrome/project-column-layout.tsx`. */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/characters'>) => {
  const { projectId } = await params
  return (
    <ProjectColumnLayout route="characters" projectId={projectId}>
      {children}
    </ProjectColumnLayout>
  )
}

export default Layout
