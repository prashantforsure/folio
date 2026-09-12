import { ContextColumn } from '../_chrome/context-column'
import { BibleNav, BibleNavFooter, NewEntryButton } from '../_bible/bible-nav'
import { enterBible } from '../../../../../../lib/bible/server'

/**
 * The bible column: the entry list beside the route, at the README's
 * 252px. The list is `BibleNav` over the same `cache()`d read the page
 * uses, so the layout and the page cost one read between them; which row
 * is selected comes from the URL below this layout, read client-side.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/bible'>) => {
  const { projectId } = await params
  const { context, load } = await enterBible(projectId)
  return (
    <>
      <ContextColumn
        route="bible"
        title={context.project.title}
        action={<NewEntryButton projectId={context.project.id} hasPitch={load.hasPitch} />}
        footer={<BibleNavFooter counts={load.counts} />}
      >
        <BibleNav projectId={context.project.id} entries={load.nav} terms={load.counts.terms} />
      </ContextColumn>
      {children}
    </>
  )
}

export default Layout
