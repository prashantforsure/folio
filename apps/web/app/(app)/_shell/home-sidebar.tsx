'use client'

import { Icon } from '@folio/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { ShellUser } from '../../../lib/auth/session'
import { AccountMenu } from './account-menu'
import { CreditsCard } from './credits-card'
import { HOME_NAV } from './home-nav'

/**
 * The home sidebar. **238px**, top to bottom: the workspace header, the four
 * nav rows, a scrolling middle, the credits card, the account button.
 *
 * `handoff-account-v2/README.md`, "Shared shell": "Credits card and account
 * button stay pinned; only the middle scrolls." That is the whole reason this
 * is three flex children rather than one scrolling column - at the 620px
 * viewport the handoff names, a long nav must not push the account button off
 * the bottom of the window, because signing out would then be unreachable.
 *
 * No card and no border. The handoff draws the sidebar directly on `--bg`
 * with the two ambient glows behind it (`.folio-ambient`, rendered by the
 * layout), and the surface card to its right is the only edge on the screen.
 * The workspace's sidebar is a floating `--s1` card; this one is not, and the
 * difference is the handoff's.
 *
 * ## Active state is `aria-current`, not a class
 *
 * `.folio-sidebar-row[aria-current='page']` carries the `--s2` fill and the
 * full ink, so the visible state and the accessible state are one expression
 * and cannot drift. `startsWith` rather than equality, so a route with
 * something below it stays lit.
 *
 * ## The workspace switcher
 *
 * Drawn, disabled, with the reason in its `title`: a person has exactly one
 * workspace here - there is no organisation, no second tenant, and
 * `memberships` joins a person to projects, not to workspaces. The handoff
 * draws the control; inventing a second workspace to put behind it would be a
 * product decision (AGENTS.md, Development philosophy 10).
 */
export const HomeSidebar = ({
  user,
  projects,
  credits,
}: {
  readonly user: ShellUser
  /** Live, unarchived projects - the count beside the Projects row. */
  readonly projects: number
  readonly credits: { readonly available: number; readonly share: number }
}) => {
  const pathname = usePathname()

  return (
    <aside
      data-home-sidebar
      aria-label="Workspace"
      className="relative z-[2] flex w-[238px] flex-none flex-col py-[12px] pl-[12px] pr-[8px]"
      style={{ minHeight: 0 }}
    >
      <div className="flex items-center gap-[9px] px-[6px] pb-[12px] pt-[4px]">
        <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-[8px] bg-solid text-12-5 font-semibold text-solid-ink">
          F
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="text-13 font-medium tracking-title">Folio</span>
          <span className="truncate text-11 text-ink3">{user.displayName}&rsquo;s workspace</span>
        </span>
        <button
          type="button"
          disabled
          title="One workspace. Folio has no second tenant to switch to - a membership joins you to projects, not to workspaces."
          className="folio-ghost-button grid h-[24px] w-[24px] flex-none place-items-center rounded-[7px] text-ink3 disabled:opacity-45"
        >
          <Icon name="switcher" size={13} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav aria-label="Sections" className="flex flex-col gap-[2px] px-[2px]">
          {HOME_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="folio-sidebar-row rounded-[9px]"
              >
                <Icon name={item.icon} size={16} strokeWidth={1.5} style={{ color: active ? 'var(--accent)' : undefined }} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.counted === true ? (
                  <span className="tabular font-mono text-11 text-ink3">{projects}</span>
                ) : null}
              </Link>
            )
          })}
        </nav>
        <div className="min-h-[12px] flex-1" />
      </div>

      <CreditsCard available={credits.available} share={credits.share} />
      <AccountMenu user={user} />
    </aside>
  )
}
