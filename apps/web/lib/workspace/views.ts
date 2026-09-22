import type { IconName } from '@folio/ui'

import type { AnySubView, SubViews } from './params'
import type { WorkspaceRoute } from './routes'

/**
 * The views each route offers, as the header's pill prints them - ruled
 * 2026-09-17 ("Redesign, the header's views" in `docs/build-decisions.md`):
 * the header's centre, where the Write / Storyboard mode pill sat, names
 * the current route's sub-views, every tab an icon (where the design draws
 * one) beside its name. One table for the nine routes so the pill
 * (`_chrome/view-pill.tsx`, through `_chrome/header-views.tsx`) is one
 * component drawn one way, and so the E2E walks read one shape.
 *
 * ## Every tab is a real `?view=` value, and every value has a tab
 *
 * A route's row is typed against `SUB_VIEW_SCHEMAS` (`params.ts`): a tab
 * cannot name a view no route parses, and `tests/workspace-routes.test.ts`
 * asserts the other direction - every value a schema accepts has a tab, in
 * the schema's order, so the first tab is the default and links to the bare
 * path. A route with no sub-view param has an empty row and no pill.
 *
 * Six routes' views are not a param, by ruling (AGENTS.md, the exception
 * table): Characters' `cast | presence | sheet` (2026-09-16; Presence replaced Relationships 2026-09-18), the
 * Storyboard's `board | canvas | list` and Scenes' `cards | index | list`
 * (both 2026-09-17), Locations' `places | scenes | sheet` and the
 * Timeline's `story | chrono | continuity` (both 2026-09-18) are client
 * state, so their rows are empty here and their tabs are
 * `_characters/view-state.tsx`, `_storyboard/view-state.tsx`,
 * `_scenes/view-state.tsx`, `_locations/view-state.tsx`,
 * `_timeline/view-state.tsx` and - with the Props pass, `Overview | List` -
 * `_props/view-state.tsx`, drawn into the same header slot as buttons.
 * All six use this `ViewTab` shape, so the pill is still one shape.
 *
 * ## Titles and labels
 *
 * `title` is the mockup's name for the view - the tooltip and the
 * accessible name. `label` is what the tab prints when the title is too
 * long for a header: the Storyboard's `Scene boards` / `Shot canvas` /
 * `Shot list` print as `Boards` / `Canvas` / `Shot list`. `icon` is drawn
 * only where a mockup draws one for that tab (Storyboard's and Scenes'
 * icon pills - both state routes now, so no row in this table carries
 * one); the record routes' mockups draw text tabs and there is no icon to
 * transcribe - inventing one is the lookalike AGENTS.md refuses.
 */
export type ViewTab<V extends string = string> = {
  readonly id: V
  /** The view's name: the tooltip and the accessible name. */
  readonly title: string
  /** What the tab prints, when shorter than `title`. */
  readonly label?: string
  /** Drawn before the label, where the design draws one. */
  readonly icon?: IconName
  /** A count drawn after the label in `--warn-bg` - the Timeline's Continuity tab and its open findings (2026-09-18). Absent or zero, no badge. */
  readonly badge?: number
}

/** The `?view=` values of one route, or `never` where the route has none. */
export type RouteView<R extends WorkspaceRoute> = SubViews<R> extends { readonly view: infer V extends string } ? V : never

export const ROUTE_VIEWS: { readonly [R in WorkspaceRoute]: readonly ViewTab<RouteView<R>>[] } = {
  script: [],
  outline: [],
  storyboard: [],
  scenes: [],
  production: [],
  characters: [],
  locations: [],
  props: [],
  timeline: [],
  research: [
    { id: 'library', title: 'Library' },
    { id: 'source', title: 'Source' },
    { id: 'clips', title: 'Clips' },
  ],
}

/** The pill's `aria-label`: `Storyboard views`. */
export const viewsLabel = (title: string): string => `${title} views`

/**
 * Which of a route's views a query string names: the tab whose id it is,
 * else the first - the default, as every sub-view param defaults to its
 * first value. `null` when the route has no views. The header reads the
 * raw `?view=` and does not refuse an unknown value here: the page already
 * did (`parseSubViews` 404s), so an unknown value never reaches a rendered
 * header.
 */
export const currentView = <R extends WorkspaceRoute>(route: R, raw: string | null): ViewTab<AnySubView> | null => {
  const tabs: readonly ViewTab<AnySubView>[] = ROUTE_VIEWS[route]
  const first = tabs[0]
  if (first === undefined) return null
  return tabs.find((tab) => tab.id === raw) ?? first
}
