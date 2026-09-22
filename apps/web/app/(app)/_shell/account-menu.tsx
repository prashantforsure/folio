'use client'

import { Avatar, Icon } from '@folio/ui'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { signOut } from '../../../lib/auth/actions'
import type { ShellUser } from '../../../lib/auth/session'
import { useDismiss } from '../../../lib/chrome/use-dismiss'

/**
 * The account button at the foot of the sidebar, and the menu above it.
 *
 * The workspace rail's `avatar-menu.tsx` is the same idea in a 56px column;
 * this is the handoff's 238px version - the avatar, the name and the address,
 * a switcher mark, and a menu that opens upward because there is no room
 * below it.
 *
 * ## Written by hand, because a headless menu is a dependency
 *
 * AGENTS.md, Deliberately not using bans opinionated component libraries, so
 * the four behaviours a menu owes are here: Escape closes it, a click outside
 * closes it, focus returns to the trigger, and the trigger carries
 * `aria-expanded` / `aria-haspopup`. `useDismiss` is the hook the workspace's
 * toolbars already share; this is its first reader outside the workspace.
 *
 * ## Two rows are drawn disabled, and say why
 *
 * `Invite a writer` and `Keyboard shortcuts` are in the handoff's menu and
 * neither exists at account level. An invite in Folio is a **share link made
 * inside a project** (AGENTS.md, Constraints: there is no email provider, so
 * "team invites are share links generated in-app and copied by the inviter"),
 * and there is no shortcut sheet to open. Drawing them disabled with the
 * reason in the `title` keeps the handoff's shape and says the true thing;
 * removing them would hide a question somebody should answer.
 *
 * Sign-out is a `<form>` posting a server action, not an `onClick`: clearing
 * a session is a mutation, and it works before hydration.
 */
export const AccountMenu = ({ user }: { readonly user: ShellUser }) => {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }
  useDismiss(open, close, root)

  return (
    <div ref={root} className="relative px-[2px]">
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="folio-menu absolute bottom-[calc(100%+8px)] left-[2px] right-[2px]"
        >
          <Link href="/app/settings" role="menuitem" className="folio-menu-item text-12-5" onClick={close}>
            Account settings
            <span className="tabular ml-auto font-mono text-10-5 text-ink3">⌘,</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled
            title="An invite is a share link made inside a project - Folio sends no mail. Open a project and use Share."
            className="folio-menu-item text-12-5"
          >
            Invite a writer
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            title="There is no shortcut sheet yet."
            className="folio-menu-item text-12-5"
          >
            Keyboard shortcuts
            <span className="tabular ml-auto font-mono text-10-5 text-ink3">?</span>
          </button>
          <form action={signOut}>
            <button type="submit" role="menuitem" className="folio-menu-item text-12-5">
              Sign out
            </button>
          </form>
        </div>
      ) : null}

      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpen((current) => !current)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="folio-ghost-button flex w-full items-center gap-[9px] rounded-[11px] px-[8px] py-[6px] text-left"
      >
        <Avatar initials={user.initials} name={user.displayName} imageUrl={user.avatarUrl} size={27} />
        <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="truncate text-12-5">{user.displayName}</span>
          <span className="truncate text-11 text-ink3">{user.email ?? '—'}</span>
        </span>
        <Icon name="switcher" size={13} strokeWidth={1.5} className="flex-none text-ink3" />
      </button>
    </div>
  )
}
