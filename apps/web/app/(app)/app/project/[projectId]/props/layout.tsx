import { PropsLayout } from '../_chrome/props-layout'

/**
 * The Props route's shell: the sidebar card with the props, the header and
 * the main surface - `_chrome/props-layout.tsx`, on the Locations layout's
 * pattern. Project-scoped: no episode in the URL, none in the crumb.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/props'>) => {
  const { projectId } = await params
  return <PropsLayout projectId={projectId}>{children}</PropsLayout>
}

export default Layout
