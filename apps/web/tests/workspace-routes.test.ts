import { ICONS } from '@folio/ui'
import { projectId, episodeSlug } from '@folio/contracts'
import { describe, expect, it } from 'vitest'

import type { EpisodeNavMeta } from '@folio/contracts'

import { CHARACTERS_VIEWS } from '../app/(app)/app/project/[projectId]/_characters/view-state'
import { LOCATIONS_VIEWS } from '../app/(app)/app/project/[projectId]/_locations/view-state'
import { SCENES_VIEWS, VIEW_LABEL } from '../app/(app)/app/project/[projectId]/_scenes/view-state'
import { STORYBOARD_VIEWS } from '../app/(app)/app/project/[projectId]/_storyboard/view-state'
import {
  defaultEpisodeTitle,
  eighths,
  episodeLabel,
  episodeNumber,
  isDefaultEpisodeTitle,
  navMeta,
  projectInitials,
} from '../lib/workspace/format'
import { episodeRouteHref, projectHref, projectRouteHref } from '../lib/workspace/hrefs'
import { parseSubViews, SUB_VIEW_SCHEMAS } from '../lib/workspace/params'
import {
  PANEL_WIDTH,
  RAIL,
  RAIL_WIDTH,
  SIDEBAR,
  SIDEBAR_WIDTH,
  WORKSPACE_ROUTES,
  WORKSPACE_ROUTE_COUNT,
  WRITING_ROUTES,
  railSectionOf,
} from '../lib/workspace/routes'
import { ROUTE_VIEWS, currentView, viewsLabel } from '../lib/workspace/views'

/**
 * The route tree, the two orders, the params and the formatting convention.
 * All data and pure functions; the E2E walk checks the same facts in a
 * browser.
 */

describe('the route tree', () => {
  it('is nine routes under the rulings on decisions 5, 6, assets and the redesign', () => {
    expect(WORKSPACE_ROUTES).toHaveLength(WORKSPACE_ROUTE_COUNT)
    expect(WORKSPACE_ROUTES).toEqual([
      'script',
      'outline',
      'storyboard',
      'scenes',
      'production',
      'characters',
      'locations',
      'timeline',
      'research',
    ])
    // Insights was removed with the v2 redesign (2026-09-16). Not one of the nine.
    expect(WORKSPACE_ROUTES).not.toContain('insights')
    // Decision 6: cut. Not routes.
    expect(WORKSPACE_ROUTES).not.toContain('build')
    expect(WORKSPACE_ROUTES).not.toContain('search')
    // assets: reserved, no route.
    expect(WORKSPACE_ROUTES).not.toContain('assets')
    // Settings is a stub, not one of the nine.
    expect(WORKSPACE_ROUTES).not.toContain('settings')
    // Bible was built, then cut 2026-09-15 - not one of the nine.
    expect(WORKSPACE_ROUTES).not.toContain('bible')
  })
})

describe('the rail', () => {
  it('is six items in the README order, each with an icon in the set, and 56px', () => {
    expect(RAIL.map((item) => `${item.label} ${item.icon}`)).toEqual([
      'Writing writing',
      'Characters characters',
      'Locations locations',
      'Timeline timeline',
      'Research research',
      'Production production',
    ])
    for (const item of RAIL) expect(ICONS[item.icon]).toBeDefined()
    expect(RAIL_WIDTH).toBe(56)
  })

  it('lights Writing for all four writing routes and itself for the rest', () => {
    for (const route of WRITING_ROUTES) expect(railSectionOf(route)).toBe('writing')
    expect(railSectionOf('production')).toBe('production')
    expect(railSectionOf('timeline')).toBe('timeline')
  })
})

describe('the writing sidebar', () => {
  it('is four rows - Script, Storyboard, Outline, Scenes - and 236px', () => {
    // Ruled 2026-09-17: Storyboard is a row under Script; the header's Write / Storyboard pill is gone.
    expect(SIDEBAR.map((item) => `${item.route} ${item.label}`)).toEqual([
      'script Script',
      'storyboard Storyboard',
      'outline Outline',
      'scenes Scenes',
    ])
    expect(SIDEBAR_WIDTH).toBe(236)
  })

  it('lists every writing route once', () => {
    expect([...SIDEBAR.map((item) => item.route)].sort()).toEqual([...WRITING_ROUTES].sort())
  })

  it('keeps the README width for the panels', () => {
    expect(PANEL_WIDTH).toBe(400)
  })
})

describe("the header's views", () => {
  it('tables every `?view=` value of every route, in the schema order, and nothing else', () => {
    for (const route of WORKSPACE_ROUTES) {
      // `view` is `z.enum(values).default(first)`: a `ZodDefault` over the enum.
      const shape: { readonly view?: { unwrap(): { readonly options: readonly string[] } } } = SUB_VIEW_SCHEMAS[route].shape
      const values = shape.view === undefined ? [] : shape.view.unwrap().options
      expect(ROUTE_VIEWS[route].map((tab) => tab.id)).toEqual(values)
      for (const tab of ROUTE_VIEWS[route]) expect(parseSubViews(route, { view: tab.id })).toEqual({ ok: true, params: { view: tab.id } })
    }
  })

  it('has no row for the routes whose views are not the URL', () => {
    // Script and Outline have one view; Characters' three (ruled 2026-09-16), the Storyboard's three and Scenes' three (both 2026-09-17) are state.
    expect(ROUTE_VIEWS.script).toEqual([])
    expect(ROUTE_VIEWS.outline).toEqual([])
    expect(ROUTE_VIEWS.characters).toEqual([])
    expect(ROUTE_VIEWS.storyboard).toEqual([])
    expect(ROUTE_VIEWS.scenes).toEqual([])
    // Locations' three and the Timeline's three joined them on 2026-09-18.
    expect(ROUTE_VIEWS.locations).toEqual([])
    expect(ROUTE_VIEWS.timeline).toEqual([])
  })

  it('draws no icon on the `?view=` routes, and prints every name', () => {
    // The two mockups that draw icon tabs (Storyboard, Scenes) are state routes now; the record routes' mockups draw text tabs.
    for (const route of WORKSPACE_ROUTES) {
      for (const tab of ROUTE_VIEWS[route]) {
        expect(tab.title.length).toBeGreaterThan(0)
        expect(tab.icon).toBeUndefined()
      }
    }
  })

  it('keeps the same tab shape on the three routes whose views are state', () => {
    // The Storyboard's, Scenes' and Characters' tabs draw icons (Characters' since its canvas pass, 2026-09-20). None is a `?view=` value.
    expect(STORYBOARD_VIEWS.map((tab) => `${tab.icon ?? '-'} ${tab.label ?? tab.title}`)).toEqual(['board Boards', 'canvas Canvas', 'list Shot list'])
    expect(SCENES_VIEWS.map((tab) => `${tab.icon ?? '-'} ${tab.label ?? tab.title}`)).toEqual(['cards Cards', 'board Index cards', 'list Scene list'])
    expect(CHARACTERS_VIEWS.map((tab) => `${tab.icon ?? '-'} ${tab.label ?? tab.title}`)).toEqual(['canvas Canvas', 'relationships Relationships', 'list List'])
    expect(LOCATIONS_VIEWS.map((tab) => `${tab.icon ?? '-'} ${tab.label ?? tab.title}`)).toEqual(['- Places', '- Scenes here', '- Sheet'])
    for (const tab of [...STORYBOARD_VIEWS, ...SCENES_VIEWS, ...CHARACTERS_VIEWS, ...LOCATIONS_VIEWS]) {
      expect(tab.title.length).toBeGreaterThan(0)
      if (tab.icon !== undefined) expect(ICONS[tab.icon]).toBeDefined()
    }
    // The Scenes toolbar's word for the view is the tab's title.
    for (const tab of SCENES_VIEWS) expect(VIEW_LABEL[tab.id]).toBe(tab.title)
  })

  it('lights the tab the URL names, else the first', () => {
    expect(currentView('production', null)?.id).toBe('scene')
    expect(currentView('production', 'episode')?.id).toBe('episode')
    expect(currentView('production', 'grid')?.id).toBe('scene')
    expect(currentView('script', 'anything')).toBeNull()
    expect(currentView('characters', 'list')).toBeNull()
    expect(currentView('storyboard', 'canvas')).toBeNull()
    expect(currentView('scenes', 'index')).toBeNull()
    expect(currentView('locations', 'sheet')).toBeNull()
    expect(viewsLabel('Storyboard')).toBe('Storyboard views')
  })
})

describe('sub-view params', () => {
  it('has a schema for every one of the nine', () => {
    expect(Object.keys(SUB_VIEW_SCHEMAS).sort()).toEqual([...WORKSPACE_ROUTES].sort())
  })

  it('defaults each param to its first value', () => {
    expect(parseSubViews('storyboard', {})).toEqual({ ok: true, params: {} }) // the views are state - ruled 2026-09-17
    expect(parseSubViews('scenes', {})).toEqual({ ok: true, params: {} }) // the views are state - ruled 2026-09-17
    expect(parseSubViews('production', {})).toEqual({ ok: true, params: { view: 'scene' } })
    expect(parseSubViews('characters', {})).toEqual({ ok: true, params: {} }) // the views are state - ruled 2026-09-16
    expect(parseSubViews('locations', {})).toEqual({ ok: true, params: {} }) // the views are state - ruled 2026-09-18
    expect(parseSubViews('timeline', {})).toEqual({ ok: true, params: {} }) // the views are state - ruled 2026-09-18
    expect(parseSubViews('research', {})).toEqual({ ok: true, params: { view: 'library' } })
    expect(parseSubViews('outline', {})).toEqual({ ok: true, params: {} })
    expect(parseSubViews('script', {})).toEqual({ ok: true, params: {} })
  })

  it('gives script no params: the cover and the panel tab are client state, ruled 2026-09-11', () => {
    // A stale `?doc=cover` or `?panel=collab` link is an unknown key - it opens the route, not a 404.
    expect(parseSubViews('script', { doc: 'cover', panel: 'collab' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('script', { doc: 'grid', panel: 'composer' })).toEqual({ ok: true, params: {} })
  })

  it('gives characters, storyboard, scenes, locations and timeline no `view`: their tabs are client state, ruled 2026-09-16, -17 and -18', () => {
    // A stale `?view=` link - a real view or not - is an unknown key on all five: it opens the first view, not a 404.
    expect(parseSubViews('characters', { view: 'presence' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('characters', { view: 'relationships' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('storyboard', { view: 'canvas' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('storyboard', { view: 'grid' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('scenes', { view: 'index' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('scenes', { view: 'grid' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('locations', { view: 'sheet' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('locations', { view: 'grid' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('timeline', { view: 'chrono' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('timeline', { view: 'lens/nobody' })).toEqual({ ok: true, params: {} })
  })

  it('refuses a value that is not one of the views, naming the param', () => {
    expect(parseSubViews('research', { view: 'grid' })).toEqual({
      ok: false,
      param: 'view',
      value: 'grid',
    })
    expect(parseSubViews('production', { view: 'lens/nobody' })).toEqual({
      ok: false,
      param: 'view',
      value: 'lens/nobody',
    })
  })

  it('takes the first of a repeated key and ignores keys it does not know', () => {
    expect(parseSubViews('research', { view: ['clips', 'library'], utm_source: 'x' })).toEqual({
      ok: true,
      params: { view: 'clips' },
    })
  })

  it('does not wire the three non-switch props as params', () => {
    // pagination, content, state/mode: not sub-views - AGENTS.md exception table.
    expect(parseSubViews('script', { pagination: 'live', content: 'empty' })).toEqual({
      ok: true,
      params: {},
    })
    expect(parseSubViews('production', { state: 'generating', mode: 'blocked' })).toEqual({
      ok: true,
      params: { view: 'scene' },
    })
  })
})

describe('hrefs', () => {
  const id = projectId('11111111-1111-4111-8111-111111111111')
  const ep = episodeSlug('ep_002')

  it('writes the episode into an episodic URL and hides it in a collapsed one', () => {
    expect(episodeRouteHref({ projectId: id, shape: 'episodic', episode: ep }, 'scenes')).toBe(
      `/app/project/${id}/ep_002/scenes`,
    )
    expect(episodeRouteHref({ projectId: id, shape: 'collapsed', episode: ep }, 'scenes')).toBe(
      `/app/project/${id}/scenes`,
    )
    expect(episodeRouteHref({ projectId: id, shape: 'collapsed', episode: ep }, 'production')).toBe(
      `/app/project/${id}/production`,
    )
    expect(projectRouteHref(id, 'timeline')).toBe(`/app/project/${id}/timeline`)
    expect(projectHref(id)).toBe(`/app/project/${id}`)
  })
})

describe('the meta convention', () => {
  const empty: EpisodeNavMeta = {
    script: 'absent',
    acts: null,
    shots: null,
    scenes: 0,
  }

  it('prints a new project as the brief specifies', () => {
    expect(WRITING_ROUTES.map((route) => navMeta(route, empty))).toEqual(['empty', '—', '—', '0'])
    expect(SIDEBAR.map((item) => navMeta(item.route, empty))).toEqual(['empty', '—', '—', '0'])
  })

  it('prints a populated episode as the bundle does', () => {
    const populated: EpisodeNavMeta = {
      script: { pages: 104 },
      acts: 3,
      shots: 38,
      scenes: 34,
    }
    expect(WRITING_ROUTES.map((route) => navMeta(route, populated))).toEqual([
      '104pp',
      '3 acts',
      '38 shots',
      '34',
    ])
  })

  it('prints a script that exists but is unmeasured as — rather than 0pp', () => {
    expect(navMeta('script', { ...empty, script: { pages: null } })).toBe('—')
  })

  it('formats eighths the way a breakdown sheet writes them', () => {
    expect(eighths(null)).toBe('—')
    expect(eighths(0)).toBe('0/8')
    expect(eighths(2)).toBe('2/8')
    expect(eighths(7)).toBe('7/8')
    expect(eighths(8)).toBe('1')
    expect(eighths(12)).toBe('1 4/8')
    expect(eighths(17)).toBe('2 1/8')
  })

  it('makes chip initials and board labels', () => {
    expect(projectInitials('Monsoon Line')).toBe('ML')
    expect(projectInitials('Folio')).toBe('Fo')
    expect(projectInitials('the sound before rain')).toBe('TS')
    expect(episodeNumber(1)).toBe('E1')
  })

  it('labels an episode as the Script mockup does, and never as "Episode 1 · Episode 1"', () => {
    expect(defaultEpisodeTitle(3)).toBe('Episode 3')
    expect(episodeLabel(1, 'Standpipe')).toBe('Episode 1 · Standpipe')
    expect(episodeLabel(1, 'Episode 1')).toBe('Episode 1')
    expect(episodeLabel(2, '  episode 2 ')).toBe('Episode 2')
    expect(episodeLabel(2, 'Episode 1')).toBe('Episode 2 · Episode 1')
    expect(isDefaultEpisodeTitle(4, 'Episode 4')).toBe(true)
    expect(isDefaultEpisodeTitle(4, 'Episode 40')).toBe(false)
  })
})
