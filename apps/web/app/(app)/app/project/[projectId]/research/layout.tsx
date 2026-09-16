import { ResearchLayout } from '../_chrome/research-layout'

/**
 * The Research route's shell: the sidebar card with the collections, the
 * header and the main surface - `_chrome/research-layout.tsx`, on the
 * Characters pattern. Project-scoped: no episode in the URL, none in the crumb.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/research'>) => {
  const { projectId } = await params
  return <ResearchLayout projectId={projectId}>{children}</ResearchLayout>
}

export default Layout
