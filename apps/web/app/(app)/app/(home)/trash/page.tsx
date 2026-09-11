import { listProjectsFor, transactionDatabase } from '@folio/db'
import Link from 'next/link'

import { requireUser } from '../../../../../lib/auth/session'
import { PageHeader } from '../../../_shell/page-header'
import { TrashRow } from './trash-row'

/**
 * `/app/trash` - soft-deleted projects. Restore, or delete forever.
 *
 * The same query as the three list routes with `trashed: true`, so a trashed
 * project's card metadata is read from the same tables and shows the same
 * things. Reached from the list header, never from the sidebar (`nav.ts`).
 *
 * ## What is not here
 *
 * No auto-purge. The competitor observation in `Route - Trash.dc.html` says
 * "purged 30 days after deletion"; that is a policy about deleting user data
 * and AGENTS.md puts it behind a question. Nothing in this repository deletes
 * a project on a timer, and the copy below does not promise that anything
 * will. No "Empty trash" or "Restore all" either: each is a bulk form of an
 * action whose single form is the one the brief asked for.
 *
 * ## Both states
 *
 * Empty is the common state - most people never trash anything - and it says
 * so plainly rather than drawing an empty table.
 */
const TrashPage = async () => {
  const user = await requireUser('/app/trash')
  const db = await transactionDatabase()
  const cards = await listProjectsFor(db, user.id, { kind: 'all', trashed: true })
  const nowMs = Date.now()

  return (
    <>
      <PageHeader
        title="Trash"
        aside="Projects you have deleted"
        actions={
          <Link
            href="/app/recents"
            className="rounded-chrome border border-line2 px-[9px] py-[3px] text-11 text-ink2 no-underline hover:bg-hover hover:text-ink hover:no-underline"
          >
            Back to recents
          </Link>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {cards.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-[8px] px-[24px] py-[56px] text-center">
            <h2 className="m-0 font-serif text-21 font-normal tracking-title">Trash is empty</h2>
            <p className="m-0 max-w-[380px] text-12 leading-[1.6] text-ink2">
              A deleted project rests here until it is restored or deleted forever. Nothing is
              waiting.
            </p>
          </div>
        ) : (
          <div className="flex max-w-[940px] flex-col gap-[12px] px-[18px] pb-[26px] pt-[14px]">
            <p className="m-0 rounded-chrome border border-line2 bg-panel px-[11px] py-[9px] text-11-5 text-ink2">
              <span className="tabular">{cards.length}</span>{' '}
              {cards.length === 1 ? 'project' : 'projects'} in the trash. Nothing here is deleted
              on a timer.
            </p>
            <ul className="m-0 list-none p-0">
              {cards.map((card) => (
                <TrashRow key={card.project.id} card={card} nowMs={nowMs} />
              ))}
            </ul>
            <p className="m-0 max-w-[520px] text-10-5 leading-[1.6] text-ink3">
              Restoring a project brings back its episodes, script, notes and revisions exactly as
              they were. Deleting forever is not switched on yet; the button explains why.
            </p>
          </div>
        )}
      </div>
    </>
  )
}

export default TrashPage
