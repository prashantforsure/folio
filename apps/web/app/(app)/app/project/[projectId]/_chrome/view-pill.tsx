'use client'

import { Icon } from '@folio/ui'
import type { IconName } from '@folio/ui'
import Link from 'next/link'

import type { EpisodeRoutePath, ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { AnySubView } from '../../../../../../lib/workspace/params'

/**
 * The toolbar's view switcher - `docs/ui design/README.md`, "Toolbar": "the
 * view-switcher pill (rounded segmented control, `--s2` on the active
 * tab)". One component for every route that has sub-views, so a view is
 * always a link over `?view=` (`lib/workspace/params.ts`) and the lit tab
 * is always `aria-current`.
 *
 * Two shapes, both the mockups' own:
 *
 *   `icon`   the Storyboard's - an 11px pill of 34×30 icon buttons, 8px
 *            radius each (`Route - Storyboard v2.dc.html`).
 *   `text`   the Production's - a 999px pill of `6px 14px` text tabs at
 *            12.5px (`Route - Production v2.dc.html`).
 *
 * The first item is the route's default view and links to the bare path,
 * as every sub-view param defaults to its first value; the others link to
 * `?view=<id>`. Both are `UrlObject`s: that is how typed routes take a
 * dynamic path with a query from inside a generic component, and the two
 * branches must share one type for `Link` to infer it.
 */

export type ViewPillItem<V extends AnySubView> = {
  readonly id: V
  readonly title: string
  /** An icon tab draws this; a text tab prints `label`, or `title` without one. */
  readonly icon?: IconName
  readonly label?: string
}

export const ViewPill = <V extends AnySubView>({
  label,
  shape,
  items,
  current,
  baseHref,
}: {
  /** The `nav`'s accessible name: `Storyboard views`. */
  readonly label: string
  readonly shape: 'icon' | 'text'
  readonly items: readonly ViewPillItem<V>[]
  readonly current: V
  /** The route's bare path; every tab but the first appends `?view=`. */
  readonly baseHref: EpisodeRoutePath | ProjectRoutePath
}) => (
  <nav aria-label={label} data-view-pill className="folio-view-pill" data-shape={shape}>
    {items.map((item, index) => (
      <Link
        key={item.id}
        href={index === 0 ? { pathname: baseHref } : { pathname: baseHref, query: { view: item.id } }}
        title={item.title}
        aria-label={shape === 'icon' ? item.title : undefined}
        aria-current={item.id === current ? 'page' : undefined}
        data-view-tab={item.id}
        className="folio-view-pill-tab"
      >
        {shape === 'icon' && item.icon !== undefined ? <Icon name={item.icon} size={16} strokeWidth={1.4} /> : (item.label ?? item.title)}
      </Link>
    ))}
  </nav>
)
