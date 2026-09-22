/**
 * The smoke-test contract for the project workspace. **This file grows every
 * phase; it is not rewritten.**
 *
 * AGENTS.md, Validation: "The E2E smoke test walks all the routes in both
 * themes and both states. It is not optional coverage - it is the thing that
 * catches a route shipped without its empty state." Ten now - Notes and
 * Revisions were built, then cut, so was Bible, Insights was removed with
 * the v2 redesign (2026-09-16), and Props was added by the Props pass.
 *
 * One row per route. `workspace.spec.ts` walks the rows; a later phase adds
 * to a row what its route must show - the empty-state copy, the populated
 * assertion - without touching the walk. The counts are asserted, so a route
 * added or cut shows up here first.
 *
 * Kept as a plain module with no Playwright import, so the unit tests can
 * read the same table.
 */

export type RailSection = 'writing' | 'characters' | 'locations' | 'props' | 'timeline' | 'research' | 'production'

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
  'props',
  'timeline',
  'research',
  'production',
]

export const RAIL_LABELS: readonly string[] = ['Writing', 'Characters', 'Locations', 'Props', 'Timeline', 'Research', 'Production']

export const RAIL_WIDTH = 56

/** The four writing routes, all of which light Writing. */
export const WRITING_ORDER: readonly string[] = ['script', 'outline', 'storyboard', 'scenes']

/** The sidebar's four rows. Storyboard became a row under Script on 2026-09-17, when the header's Write / Storyboard pill was ruled out. */
export const SIDEBAR_ORDER: readonly string[] = ['script', 'storyboard', 'outline', 'scenes']

export const SIDEBAR_WIDTH = 236

/** The sidebar metas a brand-new episode must print. */
export const EMPTY_NAV_META: Readonly<Record<string, string>> = {
  script: 'empty',
  storyboard: '—',
  outline: '—',
  scenes: '0',
}

/**
 * The header's centre since 2026-09-17: the route's views, each tab its
 * name and - where the mockup draws one - its icon. `null` where the route
 * has one view (Script, Outline) or no header of its own yet (Timeline,
 * still on its pre-redesign chrome). Characters', the Storyboard's, Scenes'
 * and Locations' tabs are buttons over state; the rest are links over `?view=`.
 */
export const HEADER_VIEWS: Readonly<Record<string, { readonly tabs: readonly string[]; readonly icons: number } | null>> = {
  script: null,
  outline: null,
  storyboard: { tabs: ['Boards', 'Canvas', 'Shot list'], icons: 3 },
  scenes: { tabs: ['Cards', 'Index cards', 'Scene list'], icons: 3 },
  /** The v12 rebuild (2026-09-22): Cards | Columns is a saved preference in the view-options popover, not a header tab. */
  production: null,
  characters: { tabs: ['Cast', 'Presence', 'Sheet'], icons: 0 },
  locations: { tabs: ['Places', 'Scenes here', 'Sheet'], icons: 0 },
  /** The Props pass: the views are state, the URL stays `/props`. */
  props: { tabs: ['Overview', 'List'], icons: 0 },
  /** The rebuild (2026-09-18): the views are state. The Continuity tab carries a count badge only while a finding is open - none on the walk's fresh project. */
  timeline: { tabs: ['Story order', 'Chronology', 'Continuity'], icons: 0 },
  research: { tabs: ['Library', 'Source', 'Clips'], icons: 0 },
}

const nav = { kind: 'sidebar', width: SIDEBAR_WIDTH } as const

export const WORKSPACE_ROUTES: readonly WorkspaceRouteRow[] = [
  { route: 'script', scope: 'episode', rail: 'writing', title: null, defaults: {}, column: nav },
  { route: 'outline', scope: 'episode', rail: 'writing', title: null, defaults: {}, column: nav },
  /** The v2 body (2026-09-16) has no `h1`: the toolbar is the count, the saved dot and `Display`. */
  { route: 'storyboard', scope: 'episode', rail: 'writing', title: null, defaults: { view: 'board' }, column: nav },
  /** The v2 body (2026-09-17) has no `h1`: the toolbar names the selected scene, or the view. The views are state the same day; the bare path still writes `data-sub-view="cards"`, as the Storyboard's row keeps `board`. */
  { route: 'scenes', scope: 'episode', rail: 'writing', title: null, defaults: { view: 'cards' }, column: nav },
  {
    route: 'production',
    scope: 'episode',
    rail: 'production',
    /** The v12 body (2026-09-22) has no `h1`: scene tabs, the reel strip and the board. */
    title: null,
    defaults: {},
    /** The v12 mockup draws no sidebar: rail, header, panel. */
    column: { kind: 'none', width: 0 },
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
    /** The toolbar's `h1` is not drawn on the empty state, which the walk's fresh project is (noted 2026-09-18, the Timeline pass). */
    title: null,
    /** The views are state since 2026-09-18; the bare path still writes `data-sub-view="places"`. */
    defaults: { view: 'places' },
    /** The rebuild (2026-09-18): the sidebar card is the location list - groups and the counts widget. */
    column: { kind: 'card', width: SIDEBAR_WIDTH },
    emptyState: { text: 'No locations yet' },
  },
  {
    route: 'props',
    scope: 'project',
    rail: 'props',
    /** The toolbar's `h1` is not drawn on the empty state, which the walk's fresh project is. */
    title: null,
    /** The views are state; the bare path still writes `data-sub-view="overview"`. */
    defaults: { view: 'overview' },
    /** The sidebar card is the prop list - category groups and the counts widget. */
    column: { kind: 'card', width: SIDEBAR_WIDTH },
    emptyState: { text: 'No props yet' },
  },
  {
    route: 'timeline',
    scope: 'project',
    rail: 'timeline',
    /** The rebuild (2026-09-18): the toolbar's `h1` is not drawn on the empty state, which the walk's fresh project is. */
    title: null,
    /** The views are state since 2026-09-18; the bare path still writes `data-sub-view="story"`. */
    defaults: { view: 'story' },
    /** The rebuild (2026-09-18): the sidebar card is the thread list and the `Placed in time` widget - the last context column is gone. */
    column: { kind: 'card', width: SIDEBAR_WIDTH },
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
 * Ten. Decision 5 episode-scoped production, decision 6 cut, assets
 * reserved; Beats cut 2026-09-12; Revisions and Notes cut 2026-09-14; Bible
 * cut 2026-09-15; Insights removed with the redesign 2026-09-16; Props
 * added by the Props pass, project-scoped, after Locations in the rail.
 */
export const WORKSPACE_ROUTE_COUNT = 10

export const THEMES = ['dark', 'light'] as const
