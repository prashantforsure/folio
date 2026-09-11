'use client'

import type { EpisodeSlug, ProjectId, RailBadges } from '@folio/contracts'
import { parseEpisodeSegment } from '@folio/contracts'
import { Glyph } from '@folio/ui'
import Link from 'next/link'
import { useSelectedLayoutSegments } from 'next/navigation'

import type { ShellUser } from '../../../../../../lib/auth/session'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import {
  episodeRouteHref,
  projectRouteHref,
  projectSettingsHref,
} from '../../../../../../lib/workspace/hrefs'
import { RAIL } from '../../../../../../lib/workspace/routes'
import type { RailSection } from '../../../../../../lib/workspace/routes'
import {
  episodeSegmentFromSegments,
  railSectionFromSegments,
} from '../../../../../../lib/workspace/segments'
import { AvatarMenu } from '../../../../_shell/avatar-menu'
import { ThemeToggle } from '../../../../_shell/theme-toggle'

/**
 * The icon rail. 66px, `--rail`, 1px right border `--line`, from
 * `Route - Script.dc.html` - the bundle that wins every chrome disagreement.
 *
 * Eight items in a fixed order, then a spacer, then the theme toggle, project
 * settings and the avatar. `RAIL` in `lib/workspace/routes.ts` is the order;
 * this component does not reorder it and the E2E smoke test reads the DOM
 * order back.
 *
 * ## Active state is two things
 *
 * AGENTS.md, UI fidelity: "Rail active state is a 2px `-accent` bar at
 * `left:-5px` **plus** the `-sel` background. Not a colour change alone."
 * Both are in `globals.css` under `.folio-rail-item[aria-current='page']`,
 * driven by one attribute, so the visible state and the accessible state
 * cannot disagree.
 *
 * **Writing stays lit on all seven episode routes** - script, outline, beats,
 * storyboard, scenes, revisions and notes, Notes and Revisions included.
 * `railSectionFromSegments` decides, and it is a pure function with a test
 * for exactly that list. Production is episode-scoped too (open decision 5,
 * ruled) but it is its own section and lights its own item.
 *
 * ## Where Writing and Production link
 *
 * To the *current* episode's script or production when the URL has one, else
 * to the episode the server chose - last opened, else first. The segment
 * comes from `useSelectedLayoutSegments()`, which is the one hook a layout
 * can use to see what is rendering below it; the fallback comes from the
 * layout as a prop. Neither is trusted for anything but a link: the server
 * validates the segment again when the link is followed.
 *
 * ## Badges
 *
 * Live counts from `readRailBadges`, passed in by the layout. A zero draws no
 * badge - the empty state shows none. Nothing here formats a number; the
 * count is printed as it arrived.
 */
export const Rail = ({
  projectId,
  initials,
  title,
  shape,
  fallbackEpisode,
  badges,
  user,
}: {
  readonly projectId: ProjectId
  readonly initials: string
  readonly title: string
  readonly shape: WorkspaceShape
  readonly fallbackEpisode: EpisodeSlug
  readonly badges: RailBadges
  readonly user: ShellUser
}) => {
  const segments = useSelectedLayoutSegments()
  const active = railSectionFromSegments(segments)
  const current = episodeSegmentFromSegments(segments)
  // The URL's segment, re-validated rather than asserted: the server has
  // already accepted it or this rail is on a 404, but a brand is not a cast.
  const checked = current === null ? null : parseEpisodeSegment(current)
  const episode = checked !== null && checked.ok ? checked.slug : fallbackEpisode
  const address = { projectId, shape, episode }

  const hrefFor = (section: RailSection) => {
    if (section === 'writing') return episodeRouteHref(address, 'script')
    if (section === 'production') return episodeRouteHref(address, 'production')
    return projectRouteHref(projectId, section)
  }

  const badgeFor = (section: RailSection): number => {
    if (section === 'characters') return badges.characters
    if (section === 'locations') return badges.locations
    if (section === 'bible') return badges.bible
    return 0
  }

  return (
    <nav
      aria-label="Project sections"
      data-rail
      className="flex w-[66px] flex-none flex-col items-center gap-[3px] border-r border-line bg-rail pb-[10px] pl-[5px] pr-[5px] pt-[12px]"
    >
      <div
        title={title}
        aria-label={title}
        className="mb-[12px] grid h-[28px] w-[28px] place-items-center rounded-chrome bg-ink text-10-5 font-semibold tracking-[.02em] text-desk"
      >
        {initials}
      </div>

      {RAIL.map((item) => {
        const badge = badgeFor(item.section)
        return (
          <Link
            key={item.section}
            href={hrefFor(item.section)}
            className="folio-rail-item"
            aria-current={active === item.section ? 'page' : undefined}
            data-rail-item={item.section}
            title={item.label}
          >
            <Glyph name={item.glyph} style={{ fontSize: 14 }} />
            <span className="folio-nav-label">{item.label}</span>
            {badge > 0 ? (
              <span className="folio-rail-badge" data-rail-badge={item.section}>
                {badge}
              </span>
            ) : null}
          </Link>
        )
      })}

      <div className="flex-1" />

      <ThemeToggle width={56} />
      <Link
        href={projectSettingsHref(projectId)}
        title="Project settings"
        aria-label="Project settings"
        className="grid h-[34px] w-[56px] place-items-center rounded-chrome text-14 text-ink3 no-underline hover:bg-hover hover:text-ink hover:no-underline"
      >
        <Glyph name="settings" />
      </Link>
      <div className="mt-[6px]">
        <AvatarMenu user={user} />
      </div>
    </nav>
  )
}
