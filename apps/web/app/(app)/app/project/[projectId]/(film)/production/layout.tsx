import { ProductionLayout } from '../../_chrome/production-layout'

/** Production's column, collapsed (film) shape. See `_chrome/production-layout.tsx`. */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/production'>) => {
  const { projectId } = await params
  return (
    <ProductionLayout projectId={projectId} episodeId={null}>
      {children}
    </ProductionLayout>
  )
}

export default Layout
