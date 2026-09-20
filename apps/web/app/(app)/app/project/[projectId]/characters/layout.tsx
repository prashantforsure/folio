import type { ReactNode } from 'react'

import { CharactersLayout } from '../_chrome/characters-layout'

/**
 * The Characters route's shell: the sidebar card with the cast, the header
 * and the main surface - `_chrome/characters-layout.tsx`, on Production's
 * pattern. Project-scoped: no episode in the URL, none in the crumb.
 *
 * `modal` is the `@modal` parallel slot: null on every URL but the
 * intercepted `/characters/:id` (`@modal/(.)[characterId]/page.tsx`,
 * `@modal/default.tsx` otherwise), which renders the edit drawer as a
 * floating sheet beside `children` rather than inside it, so opening a
 * record from the grid never remounts what `children` already has mounted.
 */
const Layout = async ({
  children,
  modal,
  params,
}: LayoutProps<'/app/project/[projectId]/characters'> & { readonly modal: ReactNode }) => {
  const { projectId } = await params
  return (
    <CharactersLayout projectId={projectId} modal={modal}>
      {children}
    </CharactersLayout>
  )
}

export default Layout
