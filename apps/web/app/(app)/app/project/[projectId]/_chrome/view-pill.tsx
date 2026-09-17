'use client'

import { Icon } from '@folio/ui'
import Link from 'next/link'

import type { EpisodeRoutePath, ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { AnySubView } from '../../../../../../lib/workspace/params'
import type { ViewTab } from '../../../../../../lib/workspace/views'

/**
 * The header's view switcher - `docs/ui design/README.md`, "Toolbar": "the
 * view-switcher pill (rounded segmented control, `--s2` on the active
 * tab)", moved from each route's toolbar to the header's centre on
 * 2026-09-17 ("Redesign, the header's views" in `docs/build-decisions.md`).
 * One component for every route that has views, so the lit tab is always
 * `aria-current` and the E2E walks read one shape.
 *
 * ## One shape: an icon beside a name
 *
 * The mockups drew two - the Storyboard's and Scenes' pills of icon-only
 * 34×30 tabs, the record routes' pills of text tabs. The client ruled the
 * icon-only shape out ("don't only show icon for them, also show their
 * name, same for all the routes"): every tab prints its name, and draws
 * its icon before it where the design has one (`lib/workspace/views.ts`
 * says which). The geometry is the mode pill's container - a 999px pill,
 * 4px padding, 3px gap - around the toolbar text pill's tabs, `6px 14px`
 * at 12.5px (the mode pill's own tabs were `7px 15px` at 13px; three named
 * tabs at that size would not leave the breadcrumb its room).
 *
 * ## Two targets: a link over `?view=`, or a callback
 *
 * A route whose views are sub-view params (`lib/workspace/params.ts`) hands
 * `baseHref`: the first item is the default and links to the bare path, as
 * every sub-view param defaults to its first value; the others link to
 * `?view=<id>`. Both are `UrlObject`s: that is how typed routes take a
 * dynamic path with a query from inside a generic component, and the two
 * branches must share one type for `Link` to infer it. `baseHref` is only
 * offered when every item is a real `?view=` value (`AnySubView`) - a tab
 * cannot link to a view no route parses.
 *
 * A route whose views are component state - Characters, ruled 2026-09-16,
 * the Storyboard and Scenes, both ruled 2026-09-17: switching must be
 * instant and must not change the URL, the Script route's own ruling for
 * its switches - hands `onSelect` instead, and the tabs are buttons. Same
 * class, same `aria-current`, so the pill looks and tests the same either
 * way.
 */

/** A tab. The same shape `lib/workspace/views.ts` tables; kept under the older name for the callers that say it. */
export type ViewPillItem<V extends string> = ViewTab<V>

type ViewPillTarget<V extends string> =
  | {
      /** The route's bare path; every tab but the first appends `?view=`. */
      readonly baseHref: [V] extends [AnySubView] ? EpisodeRoutePath | ProjectRoutePath : never
      readonly onSelect?: undefined
    }
  | {
      /** The route keeps its views as state; a tab reports the pick. */
      readonly onSelect: (view: V) => void
      readonly baseHref?: undefined
    }

export const ViewPill = <V extends string>({
  label,
  items,
  current,
  ...target
}: {
  /** The `nav`'s accessible name: `Storyboard views`. */
  readonly label: string
  readonly items: readonly ViewPillItem<V>[]
  readonly current: V
} & ViewPillTarget<V>) => (
  <nav aria-label={label} data-view-pill className="folio-view-pill">
    {items.map((item, index) => {
      const body = (
        <>
          {item.icon === undefined ? null : <Icon name={item.icon} size={15} strokeWidth={1.4} className="folio-view-pill-icon" />}
          {item.label ?? item.title}
        </>
      )
      const shared = {
        title: item.title,
        'aria-current': item.id === current ? ('page' as const) : undefined,
        'data-view-tab': item.id,
        className: 'folio-view-pill-tab',
      }
      if (target.onSelect !== undefined) {
        const onSelect = target.onSelect
        return (
          <button
            key={item.id}
            type="button"
            {...shared}
            onClick={() => {
              onSelect(item.id)
            }}
          >
            {body}
          </button>
        )
      }
      return (
        <Link key={item.id} href={index === 0 ? { pathname: target.baseHref } : { pathname: target.baseHref, query: { view: item.id } }} {...shared}>
          {body}
        </Link>
      )
    })}
  </nav>
)
