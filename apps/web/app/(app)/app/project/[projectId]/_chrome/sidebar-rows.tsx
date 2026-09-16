'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'

import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { WritingRoute } from '../../../../../../lib/workspace/routes'

export type SidebarRow = {
  readonly route: WritingRoute
  readonly label: string
  readonly meta: string
  readonly href: EpisodeRoutePath
}

/**
 * The three rows. A Client Component only so it can read which route is
 * rendering below the `(writing)` layout; everything it prints - the label,
 * the formatted meta, the href - arrives from the server as data.
 *
 * `useSelectedLayoutSegment()` from inside `(writing)/layout.tsx` is the
 * route name itself: `script`, `scenes`, and so on. The selected row gets
 * `aria-current="page"`: `--s2` fill, full ink, weight 500 (README,
 * "Sidebar": "Selected item: `--s2` fill, full-strength ink").
 */
export const SidebarRows = ({ rows }: { readonly rows: readonly SidebarRow[] }) => {
  const active = useSelectedLayoutSegment()

  return (
    <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
      {rows.map((row) => (
        <li key={row.route}>
          <Link
            href={row.href}
            className="folio-sidebar-row"
            aria-current={active === row.route ? 'page' : undefined}
            data-episode-route={row.route}
          >
            <span className="min-w-0 flex-1">{row.label}</span>
            <span className="tabular text-11 text-ink3" data-nav-meta={row.route}>
              {row.meta}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
