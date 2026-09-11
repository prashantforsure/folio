import { loadProject } from '../../../../../../lib/workspace/context'
import { PageHeader } from '../../../../_shell/page-header'

/**
 * Project settings. **A stub.** AGENTS.md, Constraints: "Project `/settings`
 * is a stub. No design exists." Where `transfer`, `keys` and `episodes` went
 * is open decision 7, and nothing here guesses.
 *
 * Reached from the rail's `⚙` and the nav header's `⋯`. It renders the
 * header so the rail has somewhere to land, and says what it is.
 */
const Page = async ({ params }: PageProps<'/app/project/[projectId]/settings'>) => {
  const { projectId } = await params
  const context = await loadProject(projectId)
  return (
    <main data-route="settings" className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader title="Settings" aside={context.project.title} />
      <div className="min-h-0 flex-1 overflow-auto p-[14px]">
        <p className="m-0 max-w-[460px] text-11-5 leading-[1.5] text-ink3">
          Project settings has no design yet, and where transfer, keys and episodes belong is still
          being decided. Nothing here can be changed for now.
        </p>
      </div>
    </main>
  )
}

export default Page
