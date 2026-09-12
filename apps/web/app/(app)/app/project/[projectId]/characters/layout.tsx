import { ContextColumn } from '../_chrome/context-column'
import { CastNav, CastNavFooter, NewCharacterButton } from '../_characters/cast-nav'
import { enterCharacters } from '../../../../../../lib/characters/server'

/**
 * The characters column: the cast list beside the route, at the README's
 * 256px. The list is `CastNav` over the same `cache()`d read the page
 * uses, so the layout and the page cost one read between them; which row
 * is selected comes from the URL below this layout, read client-side.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/characters'>) => {
  const { projectId } = await params
  const { context, load } = await enterCharacters(projectId)
  return (
    <>
      <ContextColumn
        route="characters"
        title={context.project.title}
        action={<NewCharacterButton projectId={context.project.id} />}
        footer={<CastNavFooter />}
      >
        <CastNav
          projectId={context.project.id}
          cast={load.cast}
          walkOns={load.walkOns}
          pending={load.resolve.filter((row) => row.proposal !== null).length}
        />
      </ContextColumn>
      {children}
    </>
  )
}

export default Layout
