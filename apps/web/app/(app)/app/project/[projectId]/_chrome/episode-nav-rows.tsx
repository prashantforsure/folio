'use client'

import { Glyph } from '@folio/ui'
import type { GlyphName } from '@folio/ui'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'

import type { EpisodeRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { EpisodeNavRoute } from '../../../../../../lib/workspace/routes'

export type EpisodeNavRow = {
  readonly route: EpisodeNavRoute
  readonly label: string
  readonly glyph: GlyphName
  readonly meta: string
  readonly href: EpisodeRoutePath
}

/**
 * The six rows. A Client Component only so it can read which route is
 * rendering below the `(writing)` layout; everything it prints - the label,
 * the glyph, the formatted meta, the href - arrives from the server as data.
 *
 * `useSelectedLayoutSegment()` from inside `(writing)/layout.tsx` is the
 * route name itself: `script`, `notes`, and so on. The selected row gets
 * `aria-current="page"` and `globals.css` draws `--sel` behind it.
 */
export const EpisodeNavRows = ({ rows }: { readonly rows: readonly EpisodeNavRow[] }) => {
  const active = useSelectedLayoutSegment()

  return (
    <ul className="m-0 flex list-none flex-col gap-[1px] p-0">
      {rows.map((row) => (
        <li key={row.route}>
          <Link
            href={row.href}
            className="folio-nav-row text-12-5"
            aria-current={active === row.route ? 'page' : undefined}
            data-episode-route={row.route}
          >
            <Glyph
              name={row.glyph}
              className="text-ink2"
              style={{ width: 13, fontSize: 11, textAlign: 'center' }}
            />
            {row.label}
            <span className="tabular ml-auto text-10 text-ink3" data-nav-meta={row.route}>
              {row.meta}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
