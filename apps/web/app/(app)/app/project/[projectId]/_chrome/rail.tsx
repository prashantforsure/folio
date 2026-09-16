'use client'

import type { EpisodeSlug, ProjectId, RailBadges } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'

import type { ShellUser } from '../../../../../../lib/auth/session'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { episodeRouteHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import { RAIL } from '../../../../../../lib/workspace/routes'
import type { RailSection } from '../../../../../../lib/workspace/routes'
import { AvatarMenu } from '../../../../_shell/avatar-menu'
import { ThemeToggle } from '../../../../_shell/theme-toggle'

/**
 * The icon rail. 56px, no border, on the ambient canvas - `docs/ui
 * design/README.md`, "Rail": "Sidebar toggle at top, then the six route
 * icons - Writing, Characters, Locations, Timeline, Research, Production -
 * then theme toggle and Help at the bottom."
 *
 * `RAIL` in `lib/workspace/routes.ts` is the order; the E2E smoke test reads
 * the DOM order back. Icons are `@folio/ui`'s inline SVGs, 18px on a 38px
 * button. Active: `--s2` fill and full ink; inactive `--ink3`. The old 2px
 * accent bar is gone with the redesign.
 *
 * ## Help is the avatar
 *
 * The mockup's bottom slot is theme toggle then Help. Help has nowhere to go
 * - no docs exist - and the account menu (settings, sign out) has to live
 * somewhere, so the avatar takes the slot. A button that cannot do what it
 * says is a placeholder (AGENTS.md, Production phase); an avatar menu does
 * something. Flagged in the phase record.
 *
 * ## Every icon navigates, Characters included
 *
 * `Route - Script v2.dc.html` wires the Characters icon to a 330px overlay
 * over the script rather than to `/characters`, and the first shell pass
 * built it that way. Re-ruled 2026-09-16 (the client): the icon goes
 * straight to `/characters` from every route; the overlay is gone. Six
 * links, one shape.
 */
export const Rail = ({
  projectId,
  shape,
  episode,
  active,
  badges,
  user,
  navOpen,
  onToggleNav,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  /** The episode Writing and Production link to: the URL's, else the remembered-or-first one. */
  readonly episode: EpisodeSlug
  readonly active: RailSection | null
  readonly badges: RailBadges
  readonly user: ShellUser
  readonly navOpen: boolean
  readonly onToggleNav: () => void
}) => {
  const address = { projectId, shape, episode }

  const hrefFor = (section: RailSection) => {
    if (section === 'writing') return episodeRouteHref(address, 'script')
    if (section === 'production') return episodeRouteHref(address, 'production')
    return projectRouteHref(projectId, section)
  }

  const badgeFor = (section: RailSection): number => {
    if (section === 'characters') return badges.characters
    if (section === 'locations') return badges.locations
    return 0
  }

  return (
    <nav
      aria-label="Project sections"
      data-rail
      className="relative z-[2] flex w-[56px] flex-none flex-col items-center gap-[2px] pb-[10px] pt-[10px]"
    >
      <button
        type="button"
        title={navOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-label={navOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-pressed={navOpen}
        data-sidebar-toggle
        onClick={onToggleNav}
        className="folio-rail-button mb-[8px] h-[34px] w-[34px] rounded-[10px] text-ink2"
      >
        <Icon name="menu" size={17} strokeWidth={1.4} />
      </button>

      {RAIL.map((item) => {
        const badge = badgeFor(item.section)
        const lit = active === item.section
        const body = (
          <>
            <Icon name={item.icon} />
            {badge > 0 ? (
              <span className="folio-rail-badge" data-rail-badge={item.section}>
                {badge}
              </span>
            ) : null}
          </>
        )
        return (
          <Link
            key={item.section}
            href={hrefFor(item.section)}
            aria-current={active === item.section ? 'page' : undefined}
            data-rail-item={item.section}
            data-lit={lit ? 'true' : 'false'}
            title={item.label}
            aria-label={item.label}
            className="folio-rail-button h-[38px] w-[38px] rounded-[11px]"
          >
            {body}
          </Link>
        )
      })}

      <div className="flex-1" />

      <ThemeToggle variant="rail" />
      <div className="mt-[4px]">
        <AvatarMenu user={user} />
      </div>
    </nav>
  )
}
