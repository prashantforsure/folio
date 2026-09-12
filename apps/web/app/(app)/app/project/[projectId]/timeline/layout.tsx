import { ContextColumn } from '../_chrome/context-column'
import { ThreadNav, ThreadNavFooter } from '../_timeline/thread-nav'
import { TimelineStateProvider } from '../_timeline/timeline-state'
import { enterTimeline } from '../../../../../../lib/timeline/server'

/**
 * The timeline column: the thread list beside the route, at the README's
 * 250px. The list is `ThreadNav` over the same `cache()`d read the page
 * uses, so the layout and the page cost one read between them. The
 * provider around both is the route's ephemeral state - which threads are
 * hidden, which scene is selected - shared by the column and the grid,
 * which are otherwise two trees with no channel between them.
 */
const Layout = async ({ children, params }: LayoutProps<'/app/project/[projectId]/timeline'>) => {
  const { projectId } = await params
  const { context, load } = await enterTimeline(projectId)
  return (
    <TimelineStateProvider>
      <ContextColumn
        route="timeline"
        title={context.project.title}
        footer={
          <ThreadNavFooter
            span={load.span}
            flashbacks={load.flashbacks}
            unplaced={load.scenes.length - load.placed}
          />
        }
      >
        <ThreadNav projectId={context.project.id} threads={load.threads} />
      </ContextColumn>
      {children}
    </TimelineStateProvider>
  )
}

export default Layout
