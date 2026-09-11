'use client'

import { Glyph } from '@folio/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { ShellUser } from '../../../lib/auth/session'
import { AvatarMenu } from './avatar-menu'
import { SIDEBAR } from './nav'
import { ThemeToggle } from './theme-toggle'

/**
 * The signed-in sidebar. 88px, `--rail`, 1px right border `--line`.
 *
 * Geometry, padding and the active state are the icon rail's, transcribed from
 * the design README's "App shell / 1. Icon rail" section: `12px 5px 10px`
 * padding, `gap: 3px`, 56x46 buttons, a 14px glyph above an 8px/600 uppercase
 * label at `.08em`. The rail is **labelled, not icon-only** - that is stated
 * twice in the handoff and it is the reason the buttons are 46px tall.
 *
 * ## An assumption, stated where it was made
 *
 * **There is no design bundle for this sidebar.** The fourteen route bundles
 * draw the *project* rail - Writing, Characters, Locations and the rest, inside
 * a project - and the two `Screenwriting App*.dc.html` shells are marked
 * superseded, with a stale palette, stale geometry and pre-rename route ids.
 * The app-level sidebar that this phase's brief specifies - New, Recents,
 * Screenwriting, Filmmaking - is drawn nowhere.
 *
 * So its chrome is borrowed from the project rail rather than invented: same
 * button shape, same padding, same active treatment, same type. That is a
 * guess, a conservative one, but a guess - a human should look at it. The
 * alternative was to invent a second chrome vocabulary for the outer shell,
 * which would be a larger guess wearing more confidence.
 *
 * **One measurement had to change: the column is 88px, not the rail's 66px.**
 * `SCREENWRITING` does not fit in 66px at the specified 8px/600/.08em, and
 * every other way out - wrapping the label, shrinking the type below the
 * README's floor, abbreviating a label the brief states - alters something that
 * *is* specified in order to preserve something that is not. See the note on
 * `.folio-nav-item` in `globals.css`.
 *
 * The brand chip at the top is the same 28x28 `--ink` block the rail uses for
 * project initials, carrying `Fo`. Also unspecified.
 *
 * ## Active state is two things
 *
 * AGENTS.md, UI fidelity: "Rail active state is a 2px `-accent` bar at
 * `left:-5px` **plus** the `-sel` background. Not a colour change alone."
 *
 * Both are driven by `aria-current="page"` in `globals.css` rather than by a
 * conditional class. The accessible state and the visible state then cannot
 * disagree, which is the failure a `className={active ? ... : ...}` invites: it
 * is one expression, and the `aria-current` beside it is a second one somebody
 * has to keep in step.
 *
 * `startsWith` rather than equality, so a nested route keeps its section lit -
 * the same rule as "Writing stays lit across all seven episode routes".
 */
export const Sidebar = ({ user }: { readonly user: ShellUser }) => {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Sections"
      className="flex w-[88px] flex-none flex-col items-center gap-[3px] border-r border-line bg-rail pb-[10px] pl-[5px] pr-[5px] pt-[12px]"
    >
      <Link
        href="/app"
        title="Folio"
        className="mb-[12px] grid h-[28px] w-[28px] place-items-center rounded-chrome bg-ink text-10-5 font-semibold tracking-[.02em] text-desk no-underline hover:no-underline"
      >
        Fo
      </Link>

      {SIDEBAR.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            className="folio-nav-item"
            aria-current={active ? 'page' : undefined}
            title={item.label}
          >
            <Glyph name={item.glyph} style={{ fontSize: 14 }} />
            <span className="folio-nav-label">{item.label}</span>
          </Link>
        )
      })}

      <div className="flex-1" />

      <ThemeToggle />
      <div className="mt-[6px]">
        <AvatarMenu user={user} />
      </div>
    </nav>
  )
}
