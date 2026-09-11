import Link from 'next/link'

import { enterScenes } from '../../../../../../lib/scenes/server'
import { count } from '../../../../../../lib/workspace/format'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { PageHeader } from '../../../../_shell/page-header'
import type { RouteAddress } from '../_chrome/episode-route-page'

/**
 * The Scenes header: title, the live scene count, the three view tabs.
 *
 * `Route - Scenes.dc.html`, the `<header>`: title in Newsreader 21px, then a
 * count chip, then a segmented control - `padding:2px`, 1px `--line2`, 3px
 * radius, 2px gap; each tab `4px 10px`, 11.5px, the active one `--accent-bg`
 * on `--accent`, the rest `--ink2`. The bundle titles it "Scene Board"; the
 * route is titled `Scenes` everywhere else (`ROUTE_TITLE`, the nav, the smoke
 * test), and `Route - Script.dc.html` wins on chrome, so the title is the
 * route's.
 *
 * The bundle's other two header controls are not drawn: `＋ New scene`
 * because a scene is never created here - it comes from a heading, through
 * derivation - and `⤒ Export scene report` because export is a queued job
 * that does not exist yet and a button that does nothing is a placeholder.
 *
 * The tabs are links. `?view=` is the sub-view param (`params.ts`), so a view
 * is a URL that survives being pasted into Slack, and an unknown value is a
 * 404 before this renders. The tab glyphs the bundle draws (`▦ ▣ ▤`) are
 * outside AGENTS.md's eighteen and are left off rather than added to the set
 * without a human looking - flagged in the phase report.
 *
 * The count is `scene_derivations` rows in state `present` for this
 * document - the same read the body uses, shared through `cache()`. It counts
 * to zero legitimately, so it prints `0`, never `—`.
 */

const VIEWS = [
  { id: 'cards', label: 'Cards' },
  { id: 'index', label: 'Index cards' },
  { id: 'list', label: 'Scene list' },
] as const

export type ScenesView = (typeof VIEWS)[number]['id']

export const ScenesHeader = async ({
  address,
  view,
}: {
  readonly address: RouteAddress
  readonly view: ScenesView
}) => {
  const { context, load } = await enterScenes(address.projectId, address.segment)
  const base = episodeRouteHref(context.address, 'scenes')
  const scenes = load.state === 'script' ? load.scenes.length : 0

  return (
    <PageHeader
      title={ROUTE_TITLE.scenes}
      badge={count(scenes)}
      actions={
        <nav
          aria-label="Scene views"
          className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]"
        >
          {VIEWS.map((item) => {
            const active = item.id === view
            return (
              <Link
                key={item.id}
                href={`${base}?view=${item.id}`}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-chrome px-[10px] py-[4px] text-11-5 no-underline hover:text-ink hover:no-underline ${
                  active ? 'bg-accent-bg text-accent' : 'text-ink2'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      }
    />
  )
}
