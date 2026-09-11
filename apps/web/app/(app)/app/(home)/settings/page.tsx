import { Avatar } from '@folio/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { requireUser } from '../../../../../lib/auth/session'
import { readBalancesFor } from '../../../../../lib/credits/balances'
import { PageHeader } from '../../../_shell/page-header'

/**
 * `/app/settings` - **account level only**: profile, plan, credits, billing.
 *
 * Reached from the avatar menu, never the sidebar. Project settings is a
 * different route inside the workspace and is not this page - and where its
 * `transfer`, `keys` and `episodes` went is AGENTS.md open decision 7, which
 * nothing here resolves. Nothing on this page is per project except the
 * credits table, which lists projects because that is where ledgers live.
 *
 * ## What each section can honestly show
 *
 * **Profile** is display only. The name and picture come from the sign-in
 * identity, and the `folio_sync_auth_user` trigger in migration `0001`
 * rewrites `display_name` from the auth claims on every `auth.users` update -
 * which Supabase performs at every sign-in. An edit made here would be undone
 * the next time the person signed in. Making it editable is a trigger change,
 * a migration and a decision about which of the two sources wins; flagged in
 * the phase report, not built.
 *
 * **Plan** and **billing** are display only, and there is nothing to display:
 * no plan table, no subscription, nothing wired to Dodo. AGENTS.md, When to
 * ask first covers "anything Dodo", and the brief says that work comes much
 * later. The convention for a thing that either exists or does not is `—`.
 *
 * **Credits** is computed from the append-only ledger by `readBalance`, per
 * project, and summed. With no ledger rows the sum is `0`, and it is the
 * computed zero - `coalesce(sum(delta), 0)` over an empty table - not a
 * default. There is no account-level ledger; see `lib/credits/balances.ts`.
 *
 * ## Not built
 *
 * The competitor observation in `Route - Settings.dc.html` has notifications,
 * editor defaults, a danger zone and a sub-route nav. Notifications are cut
 * (AGENTS.md, Constraints: "Nothing notifies asynchronously"); editor defaults
 * would make `format` a personal preference when it is a project's engine
 * input; deleting an account is purging user data; and a sub-route nav is a
 * set of sub-views, which are query params, which are behind "ask first". One
 * page, four sections, in order.
 */

const Section = ({
  title,
  blurb,
  children,
}: {
  readonly title: string
  readonly blurb: string
  readonly children: ReactNode
}) => (
  <section className="flex flex-col gap-[12px]">
    <div className="flex flex-col gap-[4px]">
      <h2 className="m-0 font-serif text-15 font-medium tracking-title">{title}</h2>
      <p className="m-0 text-11-5 text-ink2">{blurb}</p>
    </div>
    {children}
  </section>
)

const Row = ({
  label,
  value,
  note,
}: {
  readonly label: string
  readonly value: string
  readonly note?: string
}) => (
  <div className="flex items-baseline gap-[10px] border-b border-line2 py-[7px] text-11-5">
    <dt className="w-[96px] flex-none text-ink3">{label}</dt>
    <dd className="m-0 flex min-w-0 flex-1 flex-col gap-[2px]">
      <span className="tabular truncate text-ink">{value}</span>
      {note === undefined ? null : <span className="text-10-5 text-ink3">{note}</span>}
    </dd>
  </div>
)

const SettingsPage = async () => {
  const user = await requireUser('/app/settings')
  const balances = await readBalancesFor(user)
  const available = balances.reduce((sum, row) => sum + row.balance.available, 0)
  const reserved = balances.reduce((sum, row) => sum + row.balance.reserved, 0)

  return (
    <>
      <PageHeader
        title="Account settings"
        aside="Reached from the avatar menu"
        actions={
          <Link
            href="/app/recents"
            className="rounded-chrome border border-line2 px-[9px] py-[3px] text-11 text-ink2 no-underline hover:bg-hover hover:text-ink hover:no-underline"
          >
            Back to recents
          </Link>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex max-w-[600px] flex-col gap-[24px] px-[20px] pb-[32px] pt-[18px]">
          <Section title="Profile" blurb="How you appear on notes, revisions and shared drafts.">
            <div className="flex items-center gap-[12px] rounded-chrome border border-line2 bg-panel p-[12px]">
              <Avatar initials={user.initials} name={user.displayName} imageUrl={user.avatarUrl} size={40} />
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="truncate text-12-5">{user.displayName}</span>
                <span className="truncate text-10-5 text-ink3">{user.email ?? '—'}</span>
              </div>
            </div>
            <dl className="m-0">
              <Row label="Name" value={user.displayName} note="From the account you sign in with." />
              <Row label="Email" value={user.email ?? '—'} note="Your sign-in address." />
            </dl>
            <p className="m-0 text-10-5 leading-[1.6] text-ink3">
              Changing your name or picture here is not built yet: sign-in refreshes both from your
              identity provider, so an edit made here would not survive the next sign-in.
            </p>
          </Section>

          <Section title="Plan" blurb="Writing is unlimited. Credits are spent on generation.">
            <dl className="m-0">
              <Row label="Plan" value="—" note="No plan is on record. Plans arrive with payments." />
            </dl>
          </Section>

          <Section
            title="Credits"
            blurb="Computed from the ledger every time this page loads. Nothing here is a stored balance."
          >
            <dl className="m-0">
              <Row
                label="Available"
                value={String(available)}
                note={
                  balances.length === 0
                    ? 'Summed over an empty ledger: you have no projects yet, so no project has spent or been granted anything.'
                    : `Summed across ${String(balances.length)} ${balances.length === 1 ? 'project' : 'projects'}, after ${String(-reserved)} reserved for work in flight.`
                }
              />
            </dl>
            {balances.length === 0 ? null : (
              <table className="w-full border-collapse text-11-5">
                <thead>
                  <tr className="text-left text-9 font-semibold uppercase tracking-label text-ink3">
                    <th className="border-b border-line pb-[6px] font-semibold">Project</th>
                    <th className="border-b border-line pb-[6px] text-right font-semibold">Settled</th>
                    <th className="border-b border-line pb-[6px] text-right font-semibold">Reserved</th>
                    <th className="border-b border-line pb-[6px] text-right font-semibold">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map(({ project, balance }) => (
                    <tr key={project.id} className="border-b border-line2">
                      <td className="max-w-0 truncate py-[7px] pr-[10px]">
                        {project.title}
                        {project.trashedAt === null ? null : (
                          <span className="text-10-5 text-ink3"> · in the trash</span>
                        )}
                      </td>
                      <td className="tabular py-[7px] text-right font-mono text-11 text-ink2">
                        {balance.settled}
                      </td>
                      <td className="tabular py-[7px] text-right font-mono text-11 text-ink2">
                        {balance.reserved}
                      </td>
                      <td className="tabular py-[7px] text-right font-mono text-11">{balance.available}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="m-0 text-10-5 leading-[1.6] text-ink3">
              Credits belong to a project and are spent from its Production header. This is the
              sum of every project you belong to.
            </p>
          </Section>

          <Section title="Billing" blurb="Display only for now.">
            <dl className="m-0">
              <Row
                label="Billing"
                value="—"
                note="Nothing on record. Purchases and receipts appear here once payments are wired up."
              />
            </dl>
          </Section>
        </div>
      </div>
    </>
  )
}

export default SettingsPage
