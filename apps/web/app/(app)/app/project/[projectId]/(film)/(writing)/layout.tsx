import { WritingLayout } from '../../_chrome/writing-layout'

/**
 * The 238px episode nav, collapsed (film) shape: no episode in the URL.
 *
 * AGENTS.md, Routing: a film's episode segment is hidden by the router and
 * the schema never special-cases it - so this layout resolves the film's one
 * episode row and renders the same nav the episodic layout does, minus the
 * board. A series reaching a collapsed URL is redirected by the page.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]'>) => {
  const { projectId } = await params
  return (
    <WritingLayout projectId={projectId} episodeId={null}>
      {children}
    </WritingLayout>
  )
}

export default Layout
