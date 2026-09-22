import { listCollaboratorsFor, listLedgerFor, readCreditsFor, transactionDatabase } from '@folio/db'

import { requireUser } from '../../../../../lib/auth/session'
import { readBalancesFor } from '../../../../../lib/credits/balances'
import { SettingsWorkspace } from './settings-workspace'

/**
 * `/app/settings` - **account level only**: profile, plan, credits, the
 * editor's defaults, notifications, collaborators, integrations, security.
 *
 * Project settings is a different route inside the workspace and is not this
 * page - and where its `transfer`, `keys` and `episodes` went is AGENTS.md
 * open decision 7, which nothing here resolves.
 *
 * ## Four reads, and what each one can honestly say
 *
 *   credits        `readCreditsFor` - one sum over the append-only ledger
 *                  across this person's projects, and `readBalancesFor` the
 *                  same per project. Computed, never stored.
 *   usage          `listLedgerFor` - the ledger itself, newest first. Not a
 *                  summary of spending: the rows.
 *   collaborators  `listCollaboratorsFor` - everyone who shares a project
 *                  with this person, with the count beside them.
 *   the person     `requireUser` - the identity, overlaid with our profile row.
 *
 * Everything else the handoff draws is a control this product does not have a
 * store for, and each one says so where it is drawn rather than being left
 * out. See `settings-workspace.tsx`, which lists them in one place.
 *
 * The section nav is client state (`lib/settings/sections.ts`), so the URL
 * stays `/app/settings` whichever section is open.
 */
const SettingsPage = async () => {
  const user = await requireUser('/app/settings')
  const db = await transactionDatabase()
  const [credits, balances, ledger, collaborators] = await Promise.all([
    readCreditsFor(db, user.id),
    readBalancesFor(user),
    listLedgerFor(db, user.id),
    listCollaboratorsFor(db, user.id),
  ])

  return (
    <SettingsWorkspace
      user={user}
      credits={credits}
      projects={balances.map((row) => ({
        id: row.project.id,
        title: row.project.title,
        trashed: row.project.trashedAt !== null,
        balance: row.balance,
      }))}
      ledger={ledger}
      collaborators={collaborators}
    />
  )
}

export default SettingsPage
