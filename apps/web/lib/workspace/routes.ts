import type { IconName } from '@folio/ui'

/**
 * The route tree of the project workspace, as data. Nine routes.
 *
 * AGENTS.md, Routing, plus rulings the client made for this and later phases
 * (recorded in `docs/build-decisions.md`):
 *
 *   - open decision 5: `/production` is **episode-scoped**, so five routes
 *     carry an episode and four are project-wide;
 *   - open decision 6: `/build` and `/search` are **cut** - not routes, not
 *     reserved;
 *   - `assets` stays in `RESERVED_PROJECT_SEGMENTS` with no route;
 *   - Revisions, Notes and Bible were built, then **cut** (2026-09-14 and
 *     2026-09-15) - removed, same as Beats.
 *   - **Insights is removed** with the v2 redesign (2026-09-16,
 *     `docs/ui design/README.md`: "Routes removed in this redesign: Insights
 *     and Bible. Neither exists any more"). Its name stays reserved in
 *     `@folio/contracts` so no episode slug can ever take the segment.
 *
 * Project `/settings` is a stub (AGENTS.md, Constraints) and is not one of the
 * nine. The count is what the E2E smoke test walks, so it is exported and
 * asserted rather than implied.
 *
 * ## Three lists, and they differ on purpose
 *
 * `RAIL` is the six sections in the rail's fixed order (README, "Shell"):
 * Writing, Characters, Locations, Timeline, Research, Production. `SIDEBAR`
 * is the three rows of the writing sidebar - Script, Outline, Scenes - and
 * **Storyboard is not among them**: since the redesign it is reached through
 * the Write / Storyboard mode pill in the header, which every writing route
 * draws. `WRITING_ROUTES` is the four the pill spans.
 *
 * Writing is a section, not a route: it is lit on all four writing routes
 * and links to the current episode's script. Production is both - an
 * episode-scoped route and a rail section of its own.
 */

/** The four writing routes - the ones under the sidebar and the mode pill. */
export const WRITING_ROUTES = ['script', 'outline', 'storyboard', 'scenes'] as const

export type WritingRoute = (typeof WRITING_ROUTES)[number]

/**
 * Kept as the older name for the callers that still say it. Same four.
 * @deprecated prefer `WRITING_ROUTES` / `WritingRoute`.
 */
export const EPISODE_NAV_ROUTES = WRITING_ROUTES
export type EpisodeNavRoute = WritingRoute

/** Every episode-scoped route: the four, plus production (decision 5). */
export const EPISODE_ROUTES = [...WRITING_ROUTES, 'production'] as const

export type EpisodeRoute = (typeof EPISODE_ROUTES)[number]

/** The four project-scoped routes, in rail order. */
export const PROJECT_ROUTES = ['characters', 'locations', 'timeline', 'research'] as const

export type ProjectRoute = (typeof PROJECT_ROUTES)[number]

export type WorkspaceRoute = EpisodeRoute | ProjectRoute

/** The nine. The smoke test asserts this number. */
export const WORKSPACE_ROUTES: readonly WorkspaceRoute[] = [...EPISODE_ROUTES, ...PROJECT_ROUTES]

export const WORKSPACE_ROUTE_COUNT = 9

export const isEpisodeRoute = (value: string): value is EpisodeRoute =>
  (EPISODE_ROUTES as readonly string[]).includes(value)

export const isProjectRoute = (value: string): value is ProjectRoute =>
  (PROJECT_ROUTES as readonly string[]).includes(value)

export const isWritingRoute = (value: string): value is WritingRoute =>
  (WRITING_ROUTES as readonly string[]).includes(value)

/** Route titles, as a page header or a breadcrumb prints them. Specified copy. */
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
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

/**
 * The six rail sections. `writing` covers the four writing routes; every
 * other section is exactly one route.
 */
export const RAIL_SECTIONS = [
  'writing',
  'characters',
  'locations',
  'timeline',
  'research',
  'production',
] as const

export type RailSection = (typeof RAIL_SECTIONS)[number]

export type RailItem = {
  readonly section: RailSection
  readonly label: string
  readonly icon: IconName
}

/** Writing · Characters · Locations · Timeline · Research · Production - README, "Rail". */
export const RAIL: readonly RailItem[] = [
  { section: 'writing', label: 'Writing', icon: 'writing' },
  { section: 'characters', label: 'Characters', icon: 'characters' },
  { section: 'locations', label: 'Locations', icon: 'locations' },
  { section: 'timeline', label: 'Timeline', icon: 'timeline' },
  { section: 'research', label: 'Research', icon: 'research' },
  { section: 'production', label: 'Production', icon: 'production' },
]

/** Which rail section a route lights. The four writing routes all light Writing. */
export const railSectionOf = (route: WorkspaceRoute): RailSection =>
  route === 'production' || isProjectRoute(route) ? route : 'writing'

// ---------------------------------------------------------------------------
// The writing sidebar and the mode pill
// ---------------------------------------------------------------------------

export type SidebarItem = {
  readonly route: WritingRoute
  readonly label: string
}

/** Script · Outline · Scenes. Storyboard is the mode pill's other half. */
export const SIDEBAR: readonly SidebarItem[] = [
  { route: 'script', label: 'Script' },
  { route: 'outline', label: 'Outline' },
  { route: 'scenes', label: 'Scenes' },
]

/** @deprecated prefer `SIDEBAR`. The same three rows. */
export const EPISODE_NAV = SIDEBAR

/**
 * The header's Write / Storyboard pill. `write` is lit on Script, Outline and
 * Scenes; `storyboard` on Storyboard. Each half links to one route: Write to
 * the script (the writing surface's home), Storyboard to the board.
 */
export const WRITING_MODES = ['write', 'storyboard'] as const

export type WritingMode = (typeof WRITING_MODES)[number]

export const writingModeOf = (route: WritingRoute): WritingMode =>
  route === 'storyboard' ? 'storyboard' : 'write'

export const WRITING_MODE_TARGET: Record<WritingMode, WritingRoute> = {
  write: 'script',
  storyboard: 'storyboard',
}

// ---------------------------------------------------------------------------
// Widths, from the design README
// ---------------------------------------------------------------------------

/**
 * README, "Shell": rail 56px, sidebar 236px, header 60px, panels 400px,
 * status bar 28px. The context columns the unrebuilt record routes still
 * draw keep their earlier widths until each route's own pass.
 */
export const RAIL_WIDTH = 56
export const SIDEBAR_WIDTH = 236
export const HEADER_HEIGHT = 60
export const PANEL_WIDTH = 400
export const CONTEXT_OVERLAY_WIDTH = 330

/** @deprecated the sidebar replaced the episode nav; same number since the redesign. */
export const EPISODE_NAV_WIDTH = SIDEBAR_WIDTH

export const CONTEXT_PANEL_WIDTH: Record<Exclude<WorkspaceRoute, WritingRoute | 'characters'>, number> = {
  production: 250,
  locations: 256,
  timeline: 250,
  research: 250,
}

/**
 * README, "Breakpoints": panels are in flow at 1200 and above, the sidebar
 * opens by default at 1040 and above, and below 1200 an open panel forces the
 * sidebar closed.
 */
export const PANEL_IN_FLOW_MIN = 1200
export const SIDEBAR_OPEN_MIN = 1040
