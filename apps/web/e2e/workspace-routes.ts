/**
 * The smoke-test contract for the project workspace. **This file grows every
 * phase; it is not rewritten.**
 *
 * AGENTS.md, Validation: "The E2E smoke test walks all thirteen routes in
 * both themes and both states. It is not optional coverage - it is the thing
 * that catches a route shipped without its empty state."
 *
 * One row per route. `workspace.spec.ts` walks the rows; a later phase adds
 * to a row what its route must show - the empty-state copy, the populated
 * assertion - without touching the walk. The counts are asserted, so a route
 * added or cut shows up here first.
 *
 * Kept as a plain module with no Playwright import, so the unit tests can
 * read the same table.
 */

export type RailSection =
  | 'writing'
  | 'characters'
  | 'locations'
  | 'timeline'
  | 'bible'
  | 'research'
  | 'insights'
  | 'production'

export type WorkspaceRouteRow = {
  readonly route: string
  /** `episode`: carries `:episodeId` for a series, collapsed for a film. */
  readonly scope: 'episode' | 'project'
  /** Which rail item must carry `aria-current="page"`. */
  readonly rail: RailSection
  /** The 46px header's title. Specified copy. */
  readonly title: string
  /** The sub-view params and the default each must resolve to. */
  readonly defaults: Readonly<Record<string, string>>
  /** Which context column sits beside the page, and its width in px. */
  readonly column: { readonly kind: 'episode-nav' | 'context' | 'none'; readonly width: number }
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
  'bible',
  'research',
  'insights',
  'production',
]

export const RAIL_LABELS: readonly string[] = [
  'Writing',
  'Characters',
  'Locations',
  'Timeline',
  'Bible',
  'Research',
  'Insights',
  'Production',
]

export const EPISODE_NAV_ORDER: readonly string[] = [
  'script',
  'outline',
  'storyboard',
  'scenes',
  'revisions',
  'notes',
]

export const EPISODE_NAV_WIDTH = 238

/** The nav metas a brand-new episode must print. */
export const EMPTY_NAV_META: Readonly<Record<string, string>> = {
  script: 'empty',
  outline: '—',
  storyboard: '—',
  scenes: '0',
  revisions: '—',
  notes: '0',
}

const nav = { kind: 'episode-nav', width: EPISODE_NAV_WIDTH } as const

export const WORKSPACE_ROUTES: readonly WorkspaceRouteRow[] = [
  { route: 'script', scope: 'episode', rail: 'writing', title: 'Script', defaults: {}, column: nav },
  { route: 'outline', scope: 'episode', rail: 'writing', title: 'Outline', defaults: {}, column: nav },
  { route: 'storyboard', scope: 'episode', rail: 'writing', title: 'Storyboard', defaults: { view: 'board' }, column: nav },
  { route: 'scenes', scope: 'episode', rail: 'writing', title: 'Scenes', defaults: { view: 'cards' }, column: nav },
  { route: 'revisions', scope: 'episode', rail: 'writing', title: 'Revisions', defaults: { view: 'diff' }, column: nav },
  { route: 'notes', scope: 'episode', rail: 'writing', title: 'Notes', defaults: { filter: 'open' }, column: nav },
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
    defaults: { view: 'profile' },
    column: { kind: 'context', width: 256 },
  },
  {
    route: 'locations',
    scope: 'project',
    rail: 'locations',
    title: 'Locations',
    defaults: { view: 'record' },
    column: { kind: 'context', width: 256 },
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
    route: 'bible',
    scope: 'project',
    rail: 'bible',
    title: 'Bible',
    defaults: { view: 'entry' },
    column: { kind: 'context', width: 252 },
    emptyState: { text: 'The rules of the world live here' },
  },
  {
    route: 'research',
    scope: 'project',
    rail: 'research',
    title: 'Research',
    defaults: { view: 'library' },
    column: { kind: 'context', width: 250 },
  },
  {
    route: 'insights',
    scope: 'project',
    rail: 'insights',
    title: 'Insights',
    defaults: { report: 'pacing', lens: 'showrunner' },
    column: { kind: 'none', width: 0 },
  },
]

/** Thirteen. Decision 5 episode-scoped production, decision 6 cut, assets reserved; Beats cut 2026-09-12. */
export const WORKSPACE_ROUTE_COUNT = 13

export const THEMES = ['dark', 'light'] as const
