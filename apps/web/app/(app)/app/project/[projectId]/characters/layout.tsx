import { CharactersLayout } from '../_chrome/characters-layout'

/**
 * The Characters route's shell: the sidebar card with the cast, the header
 * and the main surface - `_chrome/characters-layout.tsx`, on Production's
 * pattern. Project-scoped: no episode in the URL, none in the crumb.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/characters'>) => {
  const { projectId } = await params
  return <CharactersLayout projectId={projectId}>{children}</CharactersLayout>
}

export default Layout
