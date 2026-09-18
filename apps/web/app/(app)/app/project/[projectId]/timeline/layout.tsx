import { TimelineLayout } from '../_chrome/timeline-layout'

/**
 * The Timeline route's shell: the sidebar card with the threads, the header
 * and the main surface - `_chrome/timeline-layout.tsx`, on the Locations
 * layout's pattern. Project-scoped: no episode in the URL, none in the crumb.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/timeline'>) => {
  const { projectId } = await params
  return <TimelineLayout projectId={projectId}>{children}</TimelineLayout>
}

export default Layout
