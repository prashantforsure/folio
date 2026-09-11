import Link from 'next/link'

import { enterRevisions } from '../../../../../../lib/revisions/server'
import { count } from '../../../../../../lib/workspace/format'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { PageHeader } from '../../../../_shell/page-header'
import type { RouteAddress } from '../_chrome/episode-route-page'
import { IssueRevisionControl } from './issue-revision'

/**
 * The Revisions header: title, the live revision count, the two view tabs,
 * and `⊕ Issue revision`.
 *
 * `Route - Revisions.dc.html`, the `<header>`: title in Newsreader 21px, a
 * count chip, a segmented control (`padding:2px`, 1px `--line2`, 3px radius,
 * 2px gap; each tab `4px 10px`, 11.5px, the active one `--accent-bg` on
 * `--accent`), then the accent button `5px 11px`, 11.5px/600.
 *
 * The count is `revisions` rows for this episode. It counts to zero
 * legitimately - a script nobody has issued yet - so it prints `0`.
 *
 * The tabs are links: `?view=` is the sub-view param (`params.ts`), so a
 * view is a URL that survives being pasted, and an unknown value is a 404
 * before this renders. The bundle's tab glyphs (`⇄`, `≡`) are drawn only
 * where AGENTS.md's set has them: `⇄` is the route's own glyph; `≡` is not
 * in the eighteen and is left off rather than added without a human looking.
 *
 * Not drawn: `⤒ Export revision pages`. Export is a queued job that does not
 * exist yet, and a button that does nothing is a placeholder (the Scenes
 * header made the same call).
 */

const VIEWS = [
  { id: 'diff', label: 'Compare', glyph: '⇄' },
  { id: 'history', label: 'History', glyph: null },
] as const

export type RevisionsView = (typeof VIEWS)[number]['id']

export const RevisionsHeader = async ({
  address,
  view,
}: {
  readonly address: RouteAddress
  readonly view: RevisionsView
}) => {
  const { context, load } = await enterRevisions(address.projectId, address.segment)
  const base = episodeRouteHref(context.address, 'revisions')
  const revisions = load.state === 'script' ? load.revisions.length : 0

  return (
    <PageHeader
      title={ROUTE_TITLE.revisions}
      badge={count(revisions)}
      actions={
        <>
          <nav
            aria-label="Revision views"
            className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]"
          >
            {VIEWS.map((item) => {
              const active = item.id === view
              return (
                <Link
                  key={item.id}
                  href={`${base}?view=${item.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-[6px] whitespace-nowrap rounded-chrome px-[10px] py-[4px] text-11-5 no-underline hover:text-ink hover:no-underline ${
                    active ? 'bg-accent-bg text-accent' : 'text-ink2'
                  }`}
                >
                  {item.glyph === null ? null : (
                    <span
                      aria-hidden="true"
                      className="text-10 opacity-70"
                      style={{ fontFamily: 'var(--font-glyph)' }}
                    >
                      {item.glyph}
                    </span>
                  )}
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="min-w-0 flex-1" />
          <IssueRevisionControl
            projectId={context.project.id}
            episode={context.episode.slug}
            next={load.state === 'script' ? load.next : null}
            hasScript={load.state === 'script'}
          />
        </>
      }
    />
  )
}
