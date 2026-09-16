import { LocationsLayout } from '../_chrome/locations-layout'

/**
 * The Locations route's shell: the sidebar card with the places, the header
 * and the main surface - `_chrome/locations-layout.tsx`, on the Characters
 * layout's pattern. Project-scoped: no episode in the URL, none in the crumb.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/locations'>) => {
  const { projectId } = await params
  return <LocationsLayout projectId={projectId}>{children}</LocationsLayout>
}

export default Layout
