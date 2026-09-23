'use client'

import type { CreditBalance } from '@folio/contracts'
import type { Collaborator, LedgerLine } from '@folio/db'
import { Avatar } from '@folio/ui'
import { useState } from 'react'
import type { ReactNode } from 'react'

import type { ShellUser } from '../../../../../lib/auth/session'
import { SECTION, SETTINGS_SECTIONS } from '../../../../../lib/settings/sections'
import type { SettingsSection } from '../../../../../lib/settings/sections'
import { useTheme } from '../../../../../lib/state/theme'
import { RouteFrame } from '../../../_shell/route-frame'
import { AccountSecurity } from './security-section'
import { ProfileForm } from './profile-form'

/**
 * Account settings: a section nav, a 660px body, and seven sections.
 *
 * ## The honest inventory
 *
 * The handoff draws a complete account page. This product has a store for
 * some of it and not the rest, so each control is one of three things, and
 * never a fourth:
 *
 *   **live**      Profile's name; Plan & credits' balance, ledger and
 *                 per-project table; Appearance; Collaborators' member list;
 *                 Integrations' two formats; Security's password change and
 *                 sign-out-everywhere.
 *   **disabled**  drawn, with the reason in its `title` and in the line under
 *                 its group: the editor toggles (no per-person store, and no
 *                 reader in the editor for one), notifications (AGENTS.md,
 *                 Constraints: "Nothing notifies asynchronously" - Folio has
 *                 no mail provider), the three third-party integrations, the
 *                 API key, two-factor.
 *   **refused**   real control, real confirmation, an answer in words:
 *                 deleting the account (`lib/settings/actions.ts`).
 *
 * Nothing here is a placeholder that looks live. That is the one rule the
 * design system states about this kind of screen and the reason the tier
 * cards below do not carry prices: there is no plan table, nothing is wired
 * to Dodo, and printing `$18/mo` would be inventing a product decision
 * (AGENTS.md, When to ask first: "credits, the ledger, refunds, or anything
 * Dodo").
 */
export const SettingsWorkspace = ({
  user,
  credits,
  projects,
  ledger,
  collaborators,
}: {
  readonly user: ShellUser
  readonly credits: Pick<CreditBalance, 'settled' | 'reserved' | 'available'>
  readonly projects: readonly {
    readonly id: string
    readonly title: string
    readonly trashed: boolean
    readonly balance: CreditBalance
  }[]
  readonly ledger: readonly LedgerLine[]
  readonly collaborators: readonly Collaborator[]
}) => {
  const [section, setSection] = useState<SettingsSection>('profile')
  const spec = SECTION[section]

  return (
    <RouteFrame crumbs={[`${user.displayName}’s workspace`, 'Account', spec.title]} scroll={false}>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Account settings"
          className="flex w-[214px] flex-none flex-col gap-[2px] overflow-y-auto border-r border-line2 px-[10px] py-[18px]"
        >
          <span className="folio-eyebrow px-[10px] pb-[8px] text-10-5">Account</span>
          {SETTINGS_SECTIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-current={section === value ? 'page' : undefined}
              onClick={() => {
                setSection(value)
              }}
              className="folio-sidebar-row h-[33px] rounded-[9px] px-[10px] py-0 text-12-5"
            >
              <span
                className="h-[5px] w-[5px] flex-none rounded-full"
                style={{ background: section === value ? 'var(--accent)' : 'var(--s3)' }}
              />
              <span className="min-w-0 flex-1 truncate">{SECTION[value].name}</span>
            </button>
          ))}
          <div className="min-h-[16px] flex-1" />
          <div className="flex flex-col gap-[5px] rounded-card border border-line2 p-[11px]">
            <span className="text-11-5 text-ink2">Signed in as</span>
            <span className="truncate font-mono text-11 text-ink3">{user.email ?? '—'}</span>
          </div>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-[30px] pb-[40px] pt-[26px]">
            <div className="flex max-w-[660px] flex-col gap-[22px]">
              <div className="flex flex-col gap-[6px]">
                <h2 className="m-0 text-23 font-normal tracking-page">{spec.title}</h2>
                <p className="m-0 text-13 leading-[1.6] text-ink2">{spec.blurb}</p>
              </div>

              {section === 'profile' ? <ProfileForm user={user} /> : null}
              {section === 'plan' ? <Plan credits={credits} projects={projects} ledger={ledger} /> : null}
              {section === 'editor' ? <EditorDefaults /> : null}
              {section === 'notifications' ? <Notifications /> : null}
              {section === 'team' ? <Collaborators collaborators={collaborators} /> : null}
              {section === 'apps' ? <Integrations /> : null}
              {section === 'security' ? <AccountSecurity /> : null}
            </div>
          </div>
        </div>
      </div>
    </RouteFrame>
  )
}

// ---------------------------------------------------------------------------
// Plan & credits
// ---------------------------------------------------------------------------

const Plan = ({
  credits,
  projects,
  ledger,
}: {
  readonly credits: Pick<CreditBalance, 'settled' | 'reserved' | 'available'>
  readonly projects: readonly {
    readonly id: string
    readonly title: string
    readonly trashed: boolean
    readonly balance: CreditBalance
  }[]
  readonly ledger: readonly LedgerLine[]
}) => {
  const share = credits.settled > 0 ? Math.max(0, Math.min(1, credits.available / credits.settled)) : 0
  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex flex-col gap-[15px] rounded-panel border border-line bg-s1 p-[20px]">
        <div className="flex flex-wrap items-start gap-[15px]">
          <span className="flex min-w-[170px] flex-1 flex-col gap-[4px]">
            <span className="text-12 text-ink2">Credits available</span>
            <span className="tabular font-mono text-40 leading-none tracking-page">
              {credits.available.toLocaleString('en-US')}
            </span>
          </span>
          <span className="flex flex-col items-end gap-[8px]">
            <span className="rounded-pill bg-s2 px-[10px] py-[3px] text-11-5 text-ink2">No plan on record</span>
            <button
              type="button"
              disabled
              title="Plans and payments are not wired up yet."
              className="folio-solid-button h-[31px] rounded-pill px-[14px] text-12-5 font-medium"
            >
              Upgrade
            </button>
          </span>
        </div>
        <div className="h-[5px] overflow-hidden rounded-[3px] bg-s3">
          <div className="h-full bg-accent" style={{ width: `${String(Math.round(share * 100))}%` }} />
        </div>
        <span className="text-12 leading-[1.5] text-ink3">
          {credits.settled === 0
            ? 'Summed over an empty ledger: nothing has been granted, spent or held. Writing and formatting never cost credits — only generation does.'
            : `Granted ${String(credits.settled)}, ${String(-credits.reserved)} held for work in flight. Writing and formatting never cost credits — only generation does.`}
        </span>
      </div>

      <Group label="Where credits live">
        <p className="m-0 text-12-5 leading-[1.55] text-ink2">
          A credit belongs to a project and is spent from that project&rsquo;s Production header.
          There is no account-level balance to buy into: the number above is the sum of the
          projects you belong to, and it is computed from the append-only ledger every time this
          page loads.
        </p>
        {projects.length === 0 ? null : (
          <table className="w-full border-collapse text-11-5">
            <thead>
              <tr className="folio-eyebrow text-left text-9-5">
                <th className="border-b border-line pb-[6px] font-medium">Project</th>
                <th className="border-b border-line pb-[6px] text-right font-medium">Granted</th>
                <th className="border-b border-line pb-[6px] text-right font-medium">Held</th>
                <th className="border-b border-line pb-[6px] text-right font-medium">Available</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((row) => (
                <tr key={row.id} className="border-b border-line2">
                  <td className="max-w-0 truncate py-[7px] pr-[10px]">
                    {row.title}
                    {row.trashed ? <span className="text-10-5 text-ink3"> · in the trash</span> : null}
                  </td>
                  <td className="tabular py-[7px] text-right font-mono text-11 text-ink2">{row.balance.settled}</td>
                  <td className="tabular py-[7px] text-right font-mono text-11 text-ink2">{row.balance.reserved}</td>
                  <td className="tabular py-[7px] text-right font-mono text-11">{row.balance.available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>

      <Group label="Recent usage">
        {ledger.length === 0 ? (
          <Note>
            Nothing has moved. Every grant, hold, spend and refund appears here, newest first, read
            straight from the ledger.
          </Note>
        ) : (
          <div className="overflow-hidden rounded-card border border-line2 bg-s1">
            {ledger.map((line) => (
              <div key={line.id} className="flex items-center gap-[13px] border-b border-line2 px-[14px] py-[11px] last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="truncate text-13">{line.projectTitle}</span>
                  <span className="text-11-5 text-ink3">
                    {line.kind}
                    {line.reason === null ? '' : ` · ${line.reason}`}
                  </span>
                </span>
                <span className="tabular font-mono text-12-5 text-ink2">
                  {line.delta > 0 ? '+' : ''}
                  {line.delta} cr
                </span>
              </div>
            ))}
          </div>
        )}
      </Group>

      <Group label="Plans">
        <Note>
          There is no plan table, no subscription and nothing connected to a payment provider, so
          there is nothing here to compare or to buy. Prices are a product decision and payments
          are one of the things this repository asks about before touching.
        </Note>
      </Group>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor defaults
// ---------------------------------------------------------------------------

const EditorDefaults = () => {
  const { theme, setTheme } = useTheme()
  return (
    <div className="flex flex-col gap-[20px]">
      <Group label="Appearance">
        <div className="flex items-center gap-[14px] rounded-card border border-line2 bg-s1 px-[15px] py-[13px]">
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="text-13">Theme</span>
            <span className="text-12 leading-[1.5] text-ink3">
              Kept in this browser. Dark is the default; a script sheet is light inside either.
            </span>
          </span>
          <div className="folio-pill-group" role="group" aria-label="Theme">
            {(['dark', 'light'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => {
                  setTheme(value)
                }}
              >
                {value === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </div>
      </Group>

      <Group label="Page format">
        <Note>
          Page format is the project&rsquo;s, not yours. It is an input to the pagination engine -
          it sets the line width, and with it the page count, the page numbers and every
          scene&rsquo;s eighths - so two people on one script cannot be allowed to disagree about
          it. It is chosen when a project is created.
        </Note>
      </Group>

      <Group label="While you write">
        <div className="flex flex-col overflow-hidden rounded-card border border-line2 bg-s1">
          <Toggle
            name="Autosave"
            desc="Saves a few seconds after you stop typing, and keeps a restore point per session."
            on
            fixed="Always on. The Script route's save path is a delta and there is no way to turn it off."
          />
          <Toggle
            name="Live page count"
            desc="Repaginates as you type instead of on pause."
            on={false}
            fixed="A per-project setting, not a personal one: it is stored on the project so collaborators count the same pages."
          />
          <Toggle
            name="Auto-capitalise headings"
            desc="INT./EXT. lines and character cues format as you leave the line."
            on
            fixed="Built into the editor's own input rules. There is no store for turning it off."
          />
          <Toggle
            name="Spell check"
            desc="Skips scene headings, character cues and transitions."
            on={false}
            fixed="The browser's, not Folio's."
          />
        </div>
        <Note>
          These are drawn because the handoff draws them, and each says why it cannot be switched:
          a personal preference needs somewhere to live and somebody to read it, and neither exists
          yet. None of them is stored.
        </Note>
      </Group>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const Notifications = () => (
  <div className="flex flex-col gap-[20px]">
    <Note tone="warn">
      <strong className="font-medium text-ink">Folio sends no mail.</strong> Confirmation and
      password-reset messages go through Supabase&rsquo;s own sender, which is rate limited to a
      handful an hour and documented as unsuitable for production; the app itself has no way to
      compose a message. So nothing notifies asynchronously: no &ldquo;your export is ready&rdquo;,
      no &ldquo;@mentioned you&rdquo;, no digest, no failure alert. A job you leave running is one
      you find out about when you come back.
    </Note>
    <Group label="What would be here">
      <div className="flex flex-col overflow-hidden rounded-card border border-line2 bg-s1">
        <Toggle name="Note replies" desc="When someone answers a note on your script." on={false} fixed={NO_MAIL} />
        <Toggle name="Mentions" desc="When a collaborator puts your name in a note." on={false} fixed={NO_MAIL} />
        <Toggle name="Revision published" desc="When a collaborator issues a new colour." on={false} fixed={NO_MAIL} />
        <Toggle name="Generation finished" desc="When a render completes, fails or runs out of credits." on={false} fixed={NO_MAIL} />
        <Toggle name="Weekly digest" desc="Monday summary of pages written and notes cleared." on={false} fixed={NO_MAIL} />
      </div>
      <Note>
        Adding a mail provider unlocks all five at once. It is a dependency decision and a product
        decision, which is why none of them is a switch that does nothing.
      </Note>
    </Group>
  </div>
)

const NO_MAIL = 'There is no mail provider, so nothing can be sent.'

// ---------------------------------------------------------------------------
// Collaborators
// ---------------------------------------------------------------------------

const Collaborators = ({ collaborators }: { readonly collaborators: readonly Collaborator[] }) => (
  <div className="flex flex-col gap-[20px]">
    <Group label="Invite">
      <Note>
        An invite in Folio is a <strong className="font-medium text-ink">share link</strong>, made
        inside the project you want to share and copied by you - there is no mail provider to send
        one. Open a project, use Share in its header, and whoever opens the link becomes a member.
      </Note>
    </Group>

    <Group label={`People you share with · ${String(collaborators.length)}`}>
      <div className="overflow-hidden rounded-card border border-line2 bg-s1">
        {collaborators.map((person) => (
          <div key={person.id} className="flex items-center gap-[12px] border-b border-line2 px-[14px] py-[12px] last:border-b-0">
            <Avatar initials={initials(person.displayName)} name={person.displayName} imageUrl={person.avatarUrl} size={30} />
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="truncate text-13">
                {person.displayName}
                {person.you ? <span className="text-ink3"> (you)</span> : null}
              </span>
              <span className="truncate text-11-5 text-ink3">
                {person.email} · {person.projects} {person.projects === 1 ? 'project' : 'projects'} with you
              </span>
            </span>
          </div>
        ))}
      </div>
    </Group>

    <Group label="What a role can do">
      <Note>
        Every membership carries a role - owner, writer, commenter - and{' '}
        <strong className="font-medium text-ink">nothing enforces one yet</strong>. Any member can
        write anything in a project they belong to. The column exists, the gate does not, and
        inventing one here would be a capability model nobody has specified. It is listed as a
        known gap rather than drawn as a permission table that does not hold.
      </Note>
    </Group>
  </div>
)

const initials = (name: string): string => {
  const words = name.trim().split(/\s+/u).filter((word) => word.length > 0)
  const first = words[0]
  if (first === undefined) return '?'
  const head = [...first][0] ?? '?'
  const second = words[1]
  return second === undefined ? head.toUpperCase() : (head + ([...second][0] ?? '')).toUpperCase()
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

const Integrations = () => (
  <div className="flex flex-col gap-[14px]">
    <div className="overflow-hidden rounded-card border border-line2 bg-s1">
      <App
        mark="FD"
        name="Final Draft"
        desc="Import and export .fdx. Revision colours and title-page fields come across; generated continueds are stripped on the way in."
        state="Built in"
      />
      <App
        mark="FN"
        name="Fountain"
        desc="Import .fountain, and export the script as Fountain from the Script route's ⋯ menu."
        state="Built in"
      />
      <App mark="DR" name="Google Drive" desc="Mirror published revisions into a production folder." />
      <App mark="DB" name="Dropbox" desc="Back up every autosave snapshot nightly." />
      <App mark="SL" name="Slack" desc="Post render results and revision notices to a channel." />
    </div>
    <Group label="API">
      <Note>
        There is no public API and no key to reveal or revoke. Folio&rsquo;s own surfaces are
        server actions inside the app; an API is a boundary somebody has to design before it can
        have a key.
      </Note>
    </Group>
  </div>
)

const App = ({
  mark,
  name,
  desc,
  state,
}: {
  readonly mark: string
  readonly name: string
  readonly desc: string
  readonly state?: string
}) => (
  <div className="flex items-center gap-[13px] border-b border-line2 px-[15px] py-[13px] last:border-b-0">
    <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-s2 font-mono text-11 text-ink2">
      {mark}
    </span>
    <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
      <span className="text-13">{name}</span>
      <span className="text-11-5 leading-[1.5] text-ink3">{desc}</span>
    </span>
    {state === undefined ? (
      <button
        type="button"
        disabled
        title="Not built. Nothing here talks to a third-party service."
        className="folio-pill-button h-[29px] rounded-[9px] px-[12px] text-12"
      >
        Connect
      </button>
    ) : (
      <span className="flex items-center gap-[6px] text-11-5 text-ok">
        <span className="h-[5px] w-[5px] rounded-full bg-current" />
        {state}
      </span>
    )}
  </div>
)

// ---------------------------------------------------------------------------
// The pieces every section uses
// ---------------------------------------------------------------------------

export const Group = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="flex flex-col gap-[9px]">
    <span className="folio-eyebrow text-10-5">{label}</span>
    {children}
  </div>
)

export const Note = ({ children, tone }: { readonly children: ReactNode; readonly tone?: 'warn' }) => (
  <p
    className="m-0 rounded-card border px-[13px] py-[11px] text-12 leading-[1.6] text-ink2"
    style={
      tone === 'warn'
        ? { borderColor: 'transparent', background: 'var(--warn-bg)' }
        : { borderColor: 'var(--line2)', background: 'var(--s1)' }
    }
  >
    {children}
  </p>
)

/**
 * A switch that is drawn and cannot be thrown, with the reason on it. Every
 * toggle on this page is one: none of them has a store, and a switch that
 * flips and forgets is worse than one that explains itself.
 */
const Toggle = ({
  name,
  desc,
  on,
  fixed,
}: {
  readonly name: string
  readonly desc: string
  readonly on: boolean
  readonly fixed: string
}) => (
  <div className="flex items-center gap-[14px] border-b border-line2 px-[15px] py-[13px] last:border-b-0">
    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className="text-13">{name}</span>
      <span className="text-12 leading-[1.5] text-ink3">{desc}</span>
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={name}
      disabled
      title={fixed}
      className="folio-switch"
    >
      <span className="folio-switch-knob" />
    </button>
  </div>
)
