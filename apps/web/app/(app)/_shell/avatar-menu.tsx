'use client'

import { Avatar, Glyph } from '@folio/ui'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import { signOut } from '../../../lib/auth/actions'
import type { ShellUser } from '../../../lib/auth/session'
import { ACCOUNT_SETTINGS } from './nav'

/**
 * The avatar, and the menu behind it.
 *
 * **Account settings is here, not in the sidebar.** So is sign-out. The sidebar
 * is four items and stays four items; see `nav.ts`.
 *
 * ## Written by hand, because a headless UI library is a dependency
 *
 * AGENTS.md, Deliberately not using bans opinionated component libraries, and
 * this phase's brief adds "especially any headless UI or icon package" to the
 * ask-first list. So the four behaviours a menu owes are here explicitly:
 * Escape closes it, a click outside closes it, focus returns to the trigger on
 * close, and the trigger carries `aria-expanded` / `aria-haspopup`. That is
 * most of what a headless menu package would have provided, and it is thirty
 * lines rather than a dependency.
 *
 * What is *not* implemented is roving-focus arrow-key navigation between items.
 * With two items and a natural tab order it buys nothing, and the honest note
 * is better than a half-built keyboard model that stops being obvious once
 * there are six items. Flagged rather than hidden.
 *
 * ## Sign-out is a form, not an onClick
 *
 * It posts to a server action. A `<button>` inside a `<form action={signOut}>`
 * still works with JavaScript disabled or not yet hydrated, and - more to the
 * point - clearing a session is a mutation, and AGENTS.md, Tech stack puts
 * mutations in Server Actions rather than in a client-side call to Supabase.
 */
export const AvatarMenu = ({ user }: { readonly user: ShellUser }) => {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    const onPointer = (event: MouseEvent) => {
      const root = container.current
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpen((current) => !current)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={user.displayName}
        className="grid cursor-pointer place-items-center rounded-full border-none bg-transparent p-0"
      >
        <Avatar initials={user.initials} name={user.displayName} imageUrl={user.avatarUrl} />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute bottom-0 left-[calc(100%+8px)] z-50 w-[210px] rounded-chrome border border-line bg-panel py-1"
        >
          <div className="border-b border-line2 px-[10px] pb-[7px] pt-[6px]">
            <p className="m-0 truncate text-12 text-ink">{user.displayName}</p>
            <p className="m-0 truncate text-10-5 text-ink3">{user.email ?? '—'}</p>
          </div>

          <Link
            href={ACCOUNT_SETTINGS}
            role="menuitem"
            title="Account settings — this route arrives in the next phase"
            className="flex items-center gap-[8px] px-[10px] py-[6px] text-11-5 text-ink2 no-underline hover:bg-hover hover:text-ink hover:no-underline"
          >
            <Glyph name="settings" style={{ width: 13, textAlign: 'center' }} />
            Account settings
          </Link>

          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-[8px] border-none bg-transparent px-[10px] py-[6px] text-left text-11-5 text-ink2 hover:bg-hover hover:text-ink"
            >
              {/*
               * No glyph. Every character in AGENTS.md's set already means a
               * route, and borrowing `⇄` (Revisions) for "sign out" would put a
               * second meaning on a mark the rail uses. The empty span keeps
               * the label aligned with the row above it.
               */}
              <span aria-hidden="true" style={{ width: 13 }} />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
