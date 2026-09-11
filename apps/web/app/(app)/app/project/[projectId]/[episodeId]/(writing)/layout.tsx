import { WritingLayout } from '../../_chrome/writing-layout'

/** The 238px episode nav, episodic shape. See `_chrome/writing-layout.tsx`. */
const Layout = async ({
  children,
  params,
}: LayoutProps<'/app/project/[projectId]/[episodeId]'>) => {
  const { projectId, episodeId } = await params
  return (
    <WritingLayout projectId={projectId} episodeId={episodeId}>
      {children}
    </WritingLayout>
  )
}

export default Layout
