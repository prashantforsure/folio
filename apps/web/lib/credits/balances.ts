import type { CreditBalance, Project } from '@folio/contracts'
import { listProjectsFor, openProjectForRequest, readBalance, transactionDatabase } from '@folio/db'

import type { ShellUser } from '../auth/session'

/**
 * Every credit balance this person can see, computed from the ledger.
 *
 * ## There is no account-level ledger, and this file does not invent one
 *
 * `credit_ledger` carries `project_id` like every other table (AGENTS.md,
 * Tenancy) and `readBalance` takes a `ProjectScope`. Credits are bought for
 * and spent by a project - AGENTS.md puts them "in the Production header,
 * where they are spent". So an account settings page has no single number to
 * read; what it can honestly show is the balance of each project the person
 * belongs to, each computed by the one function that knows how to compute
 * one, and a sum across them that is labelled as a sum.
 *
 * If credits are meant to be a property of a person - bought once, spent
 * anywhere - that is a ledger with a `user_id`, which is a schema change and a
 * credits decision, and AGENTS.md, When to ask first puts both behind a
 * question. Flagged in the phase report.
 *
 * ## The gate
 *
 * `listProjectsFor` joins through `memberships`, so the only projects a scope
 * is opened for are ones this person belongs to. Trashed projects are
 * included: their ledgers are still money, and hiding them would make the sum
 * wrong.
 *
 * ## Zero is computed, not assumed
 *
 * A project with no ledger rows gets `readBalance`'s `coalesce(sum, 0)`, so
 * the `0` on screen is the result of summing an empty ledger rather than a
 * default written here. AGENTS.md: "the balance is **computed, never
 * stored**" - and never hard-coded either.
 */

export type ProjectBalance = {
  readonly project: Project
  readonly balance: CreditBalance
}

export const readBalancesFor = async (user: ShellUser): Promise<readonly ProjectBalance[]> => {
  const db = await transactionDatabase()
  const [live, trashed] = await Promise.all([
    listProjectsFor(db, user.id, { kind: 'all', trashed: false }),
    listProjectsFor(db, user.id, { kind: 'all', trashed: true }),
  ])

  const balances: ProjectBalance[] = []
  for (const card of [...live, ...trashed]) {
    const scope = await openProjectForRequest(card.project.id, user.id)
    balances.push({ project: card.project, balance: await readBalance(scope) })
  }
  return balances
}
