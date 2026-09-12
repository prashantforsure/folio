import { ContextColumn } from '../_chrome/context-column'
import { LocationNav, LocationNavFooter, NewLocationButton } from '../_locations/location-nav'
import { enterLocations } from '../../../../../../lib/locations/server'

/**
 * The locations column: the tree beside the route, at the README's 256px.
 * The list is `LocationNav` over the same `cache()`d read the page uses, so
 * the layout and the page cost one read between them; which row is
 * selected comes from the URL below this layout, read client-side.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/locations'>) => {
  const { projectId } = await params
  const { context, load } = await enterLocations(projectId)
  return (
    <>
      <ContextColumn
        route="locations"
        title={context.project.title}
        action={<NewLocationButton projectId={context.project.id} />}
        footer={<LocationNavFooter />}
      >
        <LocationNav
          projectId={context.project.id}
          rows={load.rows}
          sceneTotal={load.sceneTotal}
          pending={load.resolve.filter((row) => row.proposal !== null).length}
          sluglinesOf={load.sluglinesOf}
        />
      </ContextColumn>
      {children}
    </>
  )
}

export default Layout
