import { listEpisodeScenes, readEpisodeBoard, readEpisodeNavMeta } from '@folio/db'
import Link from 'next/link'

import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import {
  count,
  eighths,
  episodeGroupLabel,
  navMeta,
} from '../../../../../../lib/workspace/format'
import { episodeRouteHref, projectSettingsHref } from '../../../../../../lib/workspace/hrefs'
import { EPISODE_NAV, EPISODE_NAV_WIDTH } from '../../../../../../lib/workspace/routes'
import { EpisodeBoard } from './episode-board'
import { EpisodeNavRows } from './episode-nav-rows'
import { NewEpisodeButton } from './new-episode-button'
import { SearchTrigger } from './search-trigger'

/**
 * The episode nav. **238px**, `--panel`, 1px right border `--line`.
 *
 * Transcribed from `Route - Script.dc.html`, top to bottom: the header row
 * (project title in Newsreader 15px/500, `＋`, `⋯`), the search trigger, then
 * a scrolling `nav` with two groups - the episode board and the six routes,
 * then the scenes. The credits card the bundle draws in the footer is cut
 * (AGENTS.md, Constraints); nothing is rendered in its place.
 *
 * ## Every value on this panel is read, none is written
 *
 *   episode board   `readEpisodeBoard`  - `episodes`, and `measurements.total_pages`
 *   the six metas `readEpisodeNavMeta` - see `@folio/contracts` `EpisodeNavMeta`
 *                    for the table each field comes from
 *   scenes          `listEpisodeScenes` - `scene_derivations` with
 *                    `measurement_scenes.eighths`
 *
 * and each is printed through `lib/workspace/format.ts`, which owns the
 * `104pp` / `—` / `empty` / `0` convention. A new project is entirely empty
 * states, and that is what this renders for one: `empty`, `—`, `—`, `—`,
 * `0`, `—`, `0`, and the scenes group's copy.
 *
 * ## Six rows, Storyboard above Scenes
 *
 * `EPISODE_NAV` is the order and it deliberately differs from the rail. The
 * Script bundle draws six rows with no Beats row; the other episode bundles
 * drew a seventh, Beats, which was built and then removed
 * (`docs/build-decisions.md`, "Beats route removed"), so six it is. Where
 * bundles disagree on glyphs the brief and AGENTS.md's set are followed:
 * `⋮` Outline, `▥` Storyboard.
 *
 * ## Film
 *
 * "One document. The episode board is hidden and routes collapse." A film
 * renders no board and no `＋`, and its group label is the episode's title
 * without an `Ep N ·` prefix - the row exists, the number does not mean
 * anything to a film, and that reading is an assumption noted in the report.
 */
export const EpisodeNav = async ({ context }: { readonly context: EpisodeContext }) => {
  const { scope, project, episode, address, shape } = context
  const [board, meta, scenes] = await Promise.all([
    readEpisodeBoard(scope, project.format),
    readEpisodeNavMeta(scope, episode.id, project.format),
    listEpisodeScenes(scope, episode.id, project.format),
  ])

  const rows = EPISODE_NAV.map((item) => ({
    route: item.route,
    label: item.label,
    glyph: item.glyph,
    meta: navMeta(item.route, meta),
    href: episodeRouteHref(address, item.route),
  }))

  return (
    <aside
      data-episode-nav
      aria-label="Episode"
      style={{ width: EPISODE_NAV_WIDTH }}
      className="flex flex-none flex-col border-r border-line bg-panel"
    >
      <div className="flex items-center gap-[6px] pb-[8px] pl-[10px] pr-[10px] pt-[11px]">
        <span className="min-w-0 flex-1 truncate font-serif text-15 font-medium tracking-title">
          {project.title}
        </span>
        {shape === 'episodic' ? <NewEpisodeButton projectId={project.id} /> : null}
        <Link
          href={projectSettingsHref(project.id)}
          title="Project actions"
          aria-label="Project actions"
          className="grid h-[22px] w-[22px] place-items-center rounded-chrome text-13 text-ink3 no-underline hover:bg-hover hover:no-underline"
        >
          <span aria-hidden="true" style={{ fontFamily: 'var(--font-glyph)' }}>
            ⋯
          </span>
        </Link>
      </div>

      <div className="pb-[10px] pl-[10px] pr-[10px]">
        <SearchTrigger />
      </div>

      <nav
        aria-label="Episode routes"
        className="flex flex-1 flex-col gap-[12px] overflow-y-auto pb-[14px] pl-[6px] pr-[6px]"
      >
        <div className="flex flex-col gap-[1px]">
          {shape === 'episodic' ? (
            <EpisodeBoard
              projectId={project.id}
              current={episode.slug}
              rows={board.map((row) => ({
                slug: row.episode.slug,
                ordinal: row.episode.ordinal,
                title: row.episode.title,
                pages: row.pages,
              }))}
            />
          ) : null}

          <div className="pb-[3px] pl-[8px] pr-[8px] pt-[6px] text-9-5 font-semibold uppercase tracking-label text-ink3">
            {shape === 'episodic' ? episodeGroupLabel(episode.ordinal, episode.title) : episode.title}
          </div>

          <EpisodeNavRows rows={rows} />
        </div>

        <div className="flex flex-col gap-[1px]" data-scenes-group>
          <div className="flex items-center pb-[4px] pl-[8px] pr-[8px] pt-[3px]">
            <span className="flex-1 text-9-5 font-semibold uppercase tracking-label text-ink3">
              Scenes
            </span>
            <span className="tabular text-9-5 text-ink3">{count(scenes.length)}</span>
          </div>
          {scenes.length === 0 ? (
            <p className="m-0 ml-[8px] mr-[8px] mt-[2px] text-10-5 leading-[1.5] text-ink3">
              Scenes appear here as you write headings. Nothing to list yet.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[1px] p-0">
              {scenes.map((scene) => (
                <li
                  key={scene.sceneNodeId}
                  className="flex items-baseline gap-[7px] rounded-chrome pb-[4px] pl-[8px] pr-[8px] pt-[4px]"
                >
                  <span className="tabular w-[14px] text-9-5 text-ink3">{scene.number}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-11 uppercase">
                    {scene.heading}
                  </span>
                  <span className="tabular text-9 text-ink3">{eighths(scene.eighths)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>
    </aside>
  )
}

