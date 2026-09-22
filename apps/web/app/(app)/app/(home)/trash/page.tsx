import { listProjectsFor, transactionDatabase } from '@folio/db'

import { requireUser } from '../../../../../lib/auth/session'
import { RouteFrame } from '../../../_shell/route-frame'
import { TrashRow } from './trash-row'

/**
 * `/app/trash` - soft-deleted projects. Restore, or delete forever.
 *
 * The same query as the Projects route with `trashed: true`, so a trashed
 * project's metadata is read from the same tables and shows the same things.
 * A sidebar row since 2026-09-22; it used to be reached from the list header,
 * which still links here too.
 *
 * ## What is not here
 *
 * No auto-purge. The reference designs say "purged 30 days after deletion";
 * that is a policy about deleting user data, and AGENTS.md puts it behind a
 * question. Nothing in this repository deletes a project on a timer, and the
 * copy below does not promise that anything will. No "Empty trash" either:
 * it is a bulk form of an action whose single form refuses.
 *
 * **Archived is not here.** A project put out of the way is still live, still
 * openable and still counted; it is under the Projects route's own `Archived`
 * chip. The two states are different and the two lists are different.
 */
const TrashPage = async () => {
  const user = await requireUser('/app/trash')
  const db = await transactionDatabase()
  const cards = await listProjectsFor(db, user.id, { kind: 'all', trashed: true })
  const nowMs = Date.now()

  return (
    <RouteFrame crumbs={[`${user.displayName}’s workspace`, 'Trash']}>
      {cards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-[10px] px-[24px] py-[70px] text-center">
          <span className="text-20 font-normal tracking-page">Trash is empty</span>
          <p className="m-0 max-w-[400px] text-13 leading-[1.6] text-ink2">
            A deleted project rests here until it is restored or deleted forever. Nothing is
            waiting.
          </p>
        </div>
      ) : (
        <div className="flex max-w-[940px] flex-col gap-[14px] px-[22px] pb-[40px] pt-[20px]">
          <div className="flex flex-wrap items-end gap-[14px]">
            <h2 className="m-0 flex-1 text-25 font-normal tracking-page">Trash</h2>
            <span className="tabular font-mono text-11-5 text-ink3">
              {cards.length} {cards.length === 1 ? 'project' : 'projects'}
            </span>
          </div>
          <p className="m-0 rounded-card border border-line2 bg-s1 px-[13px] py-[10px] text-12 leading-[1.5] text-ink2">
            Nothing here is deleted on a timer. Restoring a project brings back its episodes,
            script, notes and revisions exactly as they were.
          </p>
          <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
            {cards.map((card) => (
              <TrashRow key={card.project.id} card={card} nowMs={nowMs} />
            ))}
          </ul>
        </div>
      )}
    </RouteFrame>
  )
}

export default TrashPage
