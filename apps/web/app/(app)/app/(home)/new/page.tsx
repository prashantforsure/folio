import { countProjectsFor, transactionDatabase } from '@folio/db'

import { requireUser } from '../../../../../lib/auth/session'
import { RouteFrame } from '../../../_shell/route-frame'
import { ComposeNew } from './compose-new'
import { FirstRun } from './first-run'

/**
 * `/app/new` - the landing route after sign-in, where every project begins.
 *
 * ## Two states, decided by one count
 *
 * `handoff-account-v2/` draws this route twice: a compose box for somebody
 * who has done this before, and a three-step setup card for somebody who has
 * not. Which one shows is not a toggle - it is the same count the route has
 * always read (`countProjectsFor`): nobody's first project, and the card
 * walks the three axes; anybody else's, and the compose box asks the one
 * thing it needs.
 *
 * Both end in the same place: `createProject`, the three axes and a title,
 * parsed against `CreateProjectInputSchema`. There is one creation path and
 * one gate behind both screens.
 *
 * ## The greeting is the clock's, not a mood
 *
 * "Good evening" is read from the server's hour. It is the one piece of copy
 * on the route that changes by itself, and it changes because time did.
 */
const NewProjectPage = async () => {
  const user = await requireUser('/app/new')
  const db = await transactionDatabase()
  const live = await countProjectsFor(db, user.id, { trashed: false })
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user.displayName.split(/\s+/u)[0] ?? user.displayName

  return (
    <RouteFrame crumbs={[`${user.displayName}’s workspace`, 'New']}>
      {live === 0 ? (
        <FirstRun greeting={`${greeting}, ${firstName}.`} />
      ) : (
        <ComposeNew greeting={`${greeting}, ${firstName}.`} />
      )}
    </RouteFrame>
  )
}

export default NewProjectPage
