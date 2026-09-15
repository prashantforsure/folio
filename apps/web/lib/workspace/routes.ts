import type { GlyphName } from '@folio/ui'

/**
 * The route tree of the project workspace, as data. Ten routes.
 *
 * AGENTS.md, Routing, plus rulings the client made for this and later phases
 * (recorded in `docs/build-decisions.md`, "Workspace shell phase", "Notes
 * and Revisions routes removed" and "Bible route removed"):
 *
 *   - open decision 5: `/production` is **episode-scoped**, so five routes
 *     carry an episode and five are project-wide;
 *   - open decision 6: `/build` and `/search` are **cut** - not routes, not
 *     reserved;
 *   - `assets` stays in `RESERVED_PROJECT_SEGMENTS` with no route;
 *   - Revisions and Notes were built, then **cut** (ruled 2026-09-14; not
 *     redesigned, not deferred - removed, same as Beats).
 *   - Bible was built, then **cut** (ruled 2026-09-15; same treatment - its
 *     five tables were dropped in migration `0015`).
 *
 * Project `/settings` is a stub (AGENTS.md, Constraints) and is not one of the
 * ten. The count is what the E2E smoke test walks, so it is exported and
 * asserted rather than implied.
 *
 * ## Two orders, and they differ on purpose
 *
 * `RAIL` is the seven sections in the rail's fixed order. `EPISODE_NAV` is
 * the four rows of the episode nav, and **Storyboard sits above Scenes**
 * there - AGENTS.md, Routing: "Episode nav order deliberately differs from the
 * rail." Neither list is derived from the other.
 *
 * Writing is a section, not a route: it is lit on all four episode nav
 * routes and links to the current episode's script. Production is both - an
 * episode-scoped route and a rail section of its own.
 */

/** The four episode routes the episode nav lists, in nav order. */
export const EPISODE_NAV_ROUTES = ['script', 'outline', 'storyboard', 'scenes'] as const

export type EpisodeNavRoute = (typeof EPISODE_NAV_ROUTES)[number]

/** Every episode-scoped route: the four, plus production (decision 5). */
export const EPISODE_ROUTES = [...EPISODE_NAV_ROUTES, 'production'] as const

export type EpisodeRoute = (typeof EPISODE_ROUTES)[number]

/** The five project-scoped routes, in rail order. */
export const PROJECT_ROUTES = [
  'characters',
  'locations',
  'timeline',
  'research',
  'insights',
] as const

export type ProjectRoute = (typeof PROJECT_ROUTES)[number]

export type WorkspaceRoute = EpisodeRoute | ProjectRoute

/** The ten. The smoke test asserts this number. */
export const WORKSPACE_ROUTES: readonly WorkspaceRoute[] = [...EPISODE_ROUTES, ...PROJECT_ROUTES]

export const WORKSPACE_ROUTE_COUNT = 10

export const isEpisodeRoute = (value: string): value is EpisodeRoute =>
  (EPISODE_ROUTES as readonly string[]).includes(value)

export const isProjectRoute = (value: string): value is ProjectRoute =>
  (PROJECT_ROUTES as readonly string[]).includes(value)

/** Route titles, as the 46px page header prints them. Specified copy. */
export const ROUTE_TITLE: Record<WorkspaceRoute, string> = {
  script: 'Script',
  outline: 'Outline',
  storyboard: 'Storyboard',
  scenes: 'Scenes',
  production: 'Production',
  characters: 'Characters',
  locations: 'Locations',
  timeline: 'Timeline',
  research: 'Research',
  insights: 'Insights',
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

/**
 * The seven rail sections. `writing` covers the six episode nav routes;
 * every other section is exactly one route.
 */
export const RAIL_SECTIONS = [
  'writing',
  'characters',
  'locations',
  'timeline',
  'research',
  'insights',
  'production',
] as const

export type RailSection = (typeof RAIL_SECTIONS)[number]

export type RailItem = {
  readonly section: RailSection
  readonly label: string
  readonly glyph: GlyphName
}

/** Writing ✎ · Characters ◍ · Locations ⌖ · Timeline ◷ · Research ▧ · Insights ◎ · Production ▶ */
export const RAIL: readonly RailItem[] = [
  { section: 'writing', label: 'Writing', glyph: 'writing' },
  { section: 'characters', label: 'Characters', glyph: 'characters' },
  { section: 'locations', label: 'Locations', glyph: 'locations' },
  { section: 'timeline', label: 'Timeline', glyph: 'timeline' },
  { section: 'research', label: 'Research', glyph: 'research' },
  { section: 'insights', label: 'Insights', glyph: 'insights' },
  { section: 'production', label: 'Production', glyph: 'production' },
]

/** Which rail section a route lights. The six writing routes all light Writing. */
export const railSectionOf = (route: WorkspaceRoute): RailSection =>
  route === 'production' || isProjectRoute(route) ? route : 'writing'

// ---------------------------------------------------------------------------
// The episode nav
// ---------------------------------------------------------------------------

export type EpisodeNavItem = {
  readonly route: EpisodeNavRoute
  readonly label: string
  readonly glyph: GlyphName
}

/** Script ▤ · Outline ⋮ · Storyboard ▥ · Scenes ▢ */
export const EPISODE_NAV: readonly EpisodeNavItem[] = [
  { route: 'script', label: 'Script', glyph: 'script' },
  { route: 'outline', label: 'Outline', glyph: 'outline' },
  { route: 'storyboard', label: 'Storyboard', glyph: 'storyboard' },
  { route: 'scenes', label: 'Scenes', glyph: 'scenes' },
]

// ---------------------------------------------------------------------------
// Context-panel widths, from the design README
// ---------------------------------------------------------------------------

/**
 * "Episode nav ... **238px** - not 'about 240'. Timeline, Insights, Research,
 * Production 250px. Bible 252px. Characters, Locations 256px."
 *
 * Insights has no context column of its own in this phase - the README lists
 * its width, but the brief gives a column only to locations, research and
 * timeline (Bible had one too, while its route existed - cut 2026-09-15).
 * Characters lost its column in the route's second pass (2026-09-14,
 * `docs/build-decisions.md`): the card grid is the list.
 */
export const EPISODE_NAV_WIDTH = 238

export const CONTEXT_PANEL_WIDTH: Record<
  Exclude<WorkspaceRoute, EpisodeNavRoute | 'characters'>,
  number
> = {
  production: 250,
  locations: 256,
  timeline: 250,
  research: 250,
  insights: 250,
}
