import { countProjectsFor, transactionDatabase } from '@folio/db'
import Link from 'next/link'

import { requireUser } from '../../../../../lib/auth/session'
import { PageHeader } from '../../../_shell/page-header'
import { NewProjectForm } from './new-project-form'

/**
 * `/app/new` - the landing route after login, where every project begins.
 *
 * It collects a title and the three axes - `kind`, `projectType`, `format` -
 * and creates the project, its owner membership and **one episode row**, then
 * opens it. The form is `new-project-form.tsx`; the action is
 * `lib/projects/actions.ts`; the write is `createProjectFor` in `@folio/db`.
 *
 * ## The two states
 *
 * A form has no rows to be empty of, so its two states are the two people who
 * arrive at it: someone with no projects yet, for whom this is the first
 * screen after onboarding, and someone starting another. The first sees copy
 * that says so and no way back to a list that has nothing in it; the second
 * sees a plain "New project" and a link back to Recents. Decided by one count
 * of live projects, the same read the list routes make.
 *
 * ## Filmmaking is offered here on purpose
 *
 * AGENTS.md, Constraints: "`/app/filmmaking` is a project list and a creation
 * entry point." This form is that entry point. What it does not do is send a
 * filmmaking project anywhere but back to its list - see `workspaceHref`.
 */
const NewProjectPage = async () => {
  const user = await requireUser('/app/new')
  const db = await transactionDatabase()
  const live = await countProjectsFor(db, user.id, { trashed: false })
  const first = live === 0

  return (
    <>
      <PageHeader
        title="New"
        aside={first ? 'Your first project' : 'A new project'}
        actions={
          first ? undefined : (
            <Link
              href="/app/recents"
              className="rounded-chrome border border-line2 px-[9px] py-[3px] text-11 text-ink2 no-underline hover:bg-hover hover:text-ink hover:no-underline"
            >
              Back to recents
            </Link>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[560px] flex-col gap-[16px] px-[24px] py-[40px]">
          <div className="flex flex-col gap-[6px]">
            <h2 className="m-0 font-serif text-21 font-normal tracking-title">
              {first ? 'Start your first project' : 'Start a project'}
            </h2>
            <p className="m-0 text-12 leading-[1.6] text-ink2">
              {first
                ? 'Three choices decide the workspace you land in: what you are making, whether it is one film or a series of episodes, and the page format the script is measured on. Every project begins here.'
                : 'What you are making, whether it is one film or a series, and the page format it is measured on. The three together decide the workspace you land in.'}
            </p>
          </div>

          <NewProjectForm />
        </div>
      </div>
    </>
  )
}

export default NewProjectPage
