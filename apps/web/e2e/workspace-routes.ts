/**
 * The smoke-test contract for the project workspace. **This file grows every
 * phase; it is not rewritten.**
 *
 * AGENTS.md, Validation: "The E2E smoke test walks all the routes in both
 * themes and both states. It is not optional coverage - it is the thing that
 * catches a route shipped without its empty state." Nine now - Notes and
 * Revisions were built, then cut, so was Bible, and Insights was removed with
 * the v2 redesign (2026-09-16).
 *
 * One row per route. `workspace.spec.ts` walks the rows; a later phase adds
 * to a row what its route must show - the empty-state copy, the populated
 * assertion - without touching the walk. The counts are asserted, so a route
 * added or cut shows up here first.
 *
 * Kept as a plain module with no Playwright import, so the unit tests can
 * read the same table.
 */

export type RailSection = 'writing' | 'characters' | 'locations' | 'timeline' | 'research' | 'production'

export type WorkspaceRouteRow = {
  readonly route: string
  /** `episode`: carries `:episodeId` for a series, collapsed for a film. */
  readonly scope: 'episode' | 'project'
  /** Which rail item must carry `aria-current="page"`. */
  readonly rail: RailSection
  /** The route's `h1`, where the route still draws one. The redesigned Script has none. */
  readonly title: string | null
  /** The sub-view params and the default each must resolve to. */
  readonly defaults: Readonly<Record<string, string>>
  /** Which column sits beside the page, and its width in px. */
  /** `card`: the route's own 236px sidebar card - the shared `Sidebar` with the route's slots, no writing rows (Characters). */
  readonly column: { readonly kind: 'sidebar' | 'context' | 'card' | 'none'; readonly width: number }
  /**
   * Added by later phases: what the route's empty state must show. Empty
   * this phase because the routes are empty shells - which is the honest
   * statement of where the contract stands.
   */
  readonly emptyState?: { readonly text: string }
}

export const RAIL_ORDER: readonly RailSection[] = [
  'writing',
  'characters',
  'locations',
  'timeline',
  'research',
  'production',
]

export const RAIL_LABELS: readonly string[] = ['Writing', 'Characters', 'Locations', 'Timeline', 'Research', 'Production']

export const RAIL_WIDTH = 56

/** The four writing routes, all of which light Writing. */
export const WRITING_ORDER: readonly string[] = ['script', 'outline', 'storyboard', 'scenes']

/** The sidebar's three rows. Storyboard is the header pill's other half. */
export const SIDEBAR_ORDER: readonly string[] = ['script', 'outline', 'scenes']

export const SIDEBAR_WIDTH = 236

/** The sidebar metas a brand-new episode must print. */
export const EMPTY_NAV_META: Readonly<Record<string, string>> = {
  script: 'empty',
  outline: '—',
  scenes: '0',
}

const nav = { kind: 'sidebar', width: SIDEBAR_WIDTH } as const

export const WORKSPACE_ROUTES: readonly WorkspaceRouteRow[] = [
  { route: 'script', scope: 'episode', rail: 'writing', title: null, defaults: {}, column: nav },
  { route: 'outline', scope: 'episode', rail: 'writing', title: null, defaults: {}, column: nav },
  { route: 'storyboard', scope: 'episode', rail: 'writing', title: 'Storyboard', defaults: { view: 'board' }, column: nav },
  { route: 'scenes', scope: 'episode', rail: 'writing', title: 'Scenes', defaults: { view: 'cards' }, column: nav },
  {
    route: 'production',
    scope: 'episode',
    rail: 'production',
    title: 'Production',
    defaults: { view: 'scene' },
    column: { kind: 'context', width: 250 },
  },
  {
    route: 'characters',
    scope: 'project',
    rail: 'characters',
    title: 'Characters',
    defaults: { view: 'cast' },
    /** The v2 pass (2026-09-16): the sidebar card is the cast list - groups and the Defined widget. */
    column: { kind: 'card', width: SIDEBAR_WIDTH },
  },
  {
    route: 'locations',
    scope: 'project',
    rail: 'locations',
    title: 'Locations',
    defaults: { view: 'places' },
    /** The v2 pass (2026-09-16): the sidebar card is the location list - groups and the Scouted widget. */
    column: { kind: 'card', width: SIDEBAR_WIDTH },
    emptyState: { text: 'No locations yet' },
  },
  {
    route: 'timeline',
    scope: 'project',
    rail: 'timeline',
    title: 'Timeline',
    defaults: { view: 'story' },
    column: { kind: 'context', width: 250 },
    emptyState: { text: 'Your scenes have a page order, not a story time' },
  },
  {
    route: 'research',
    scope: 'project',
    rail: 'research',
    title: 'Research',
    defaults: { view: 'library' },
    /** The v2 pass (2026-09-16): the sidebar card is the collection list and the `Clips filed` widget. */
    column: { kind: 'card', width: SIDEBAR_WIDTH },
    emptyState: { text: 'Nothing in research yet' },
  },
]

/**
 * Nine. Decision 5 episode-scoped production, decision 6 cut, assets
 * reserved; Beats cut 2026-09-12; Revisions and Notes cut 2026-09-14; Bible
 * cut 2026-09-15; Insights removed with the redesign 2026-09-16.
 */
export const WORKSPACE_ROUTE_COUNT = 9

export const THEMES = ['dark', 'light'] as const
