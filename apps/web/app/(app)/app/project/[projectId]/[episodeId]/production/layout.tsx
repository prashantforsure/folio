import { ProductionLayout } from '../../_chrome/production-layout'

/** Production's column, episodic shape. See `_chrome/production-layout.tsx`. */
const Layout = async ({
  children,
  params,
}: LayoutProps<'/app/project/[projectId]/[episodeId]/production'>) => {
  const { projectId, episodeId } = await params
  return (
    <ProductionLayout projectId={projectId} episodeId={episodeId}>
      {children}
    </ProductionLayout>
  )
}

export default Layout
