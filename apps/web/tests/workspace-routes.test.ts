import { ICONS } from '@folio/ui'
import { projectId, episodeSlug } from '@folio/contracts'
import { describe, expect, it } from 'vitest'

import type { EpisodeNavMeta } from '@folio/contracts'

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
  CONTEXT_PANEL_WIDTH,
  PANEL_WIDTH,
  RAIL,
  RAIL_WIDTH,
  SIDEBAR,
  SIDEBAR_WIDTH,
  WORKSPACE_ROUTES,
  WORKSPACE_ROUTE_COUNT,
  WRITING_ROUTES,
  railSectionOf,
  writingModeOf,
} from '../lib/workspace/routes'

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

describe('the writing sidebar and the mode pill', () => {
  it('is three rows - Script, Outline, Scenes - and 236px', () => {
    expect(SIDEBAR.map((item) => `${item.route} ${item.label}`)).toEqual(['script Script', 'outline Outline', 'scenes Scenes'])
    expect(SIDEBAR_WIDTH).toBe(236)
  })

  it('puts Storyboard in the header pill, not the sidebar', () => {
    expect(SIDEBAR.map((item) => item.route)).not.toContain('storyboard')
    expect(writingModeOf('storyboard')).toBe('storyboard')
    for (const route of ['script', 'outline', 'scenes'] as const) expect(writingModeOf(route)).toBe('write')
  })

  it('keeps the README widths for the panels and the unrebuilt columns', () => {
    expect(PANEL_WIDTH).toBe(400)
    expect(CONTEXT_PANEL_WIDTH).toEqual({
      production: 250,
      locations: 256,
      timeline: 250,
      research: 250,
    })
  })
})

describe('sub-view params', () => {
  it('has a schema for every one of the nine', () => {
    expect(Object.keys(SUB_VIEW_SCHEMAS).sort()).toEqual([...WORKSPACE_ROUTES].sort())
  })

  it('defaults each param to its first value', () => {
    expect(parseSubViews('storyboard', {})).toEqual({ ok: true, params: { view: 'board' } })
    expect(parseSubViews('scenes', {})).toEqual({ ok: true, params: { view: 'cards' } })
    expect(parseSubViews('production', {})).toEqual({ ok: true, params: { view: 'scene' } })
    expect(parseSubViews('characters', {})).toEqual({ ok: true, params: { view: 'overview' } })
    expect(parseSubViews('locations', {})).toEqual({ ok: true, params: { view: 'record' } })
    expect(parseSubViews('timeline', {})).toEqual({ ok: true, params: { view: 'story' } })
    expect(parseSubViews('research', {})).toEqual({ ok: true, params: { view: 'library' } })
    expect(parseSubViews('outline', {})).toEqual({ ok: true, params: {} })
    expect(parseSubViews('script', {})).toEqual({ ok: true, params: {} })
  })

  it('gives script no params: the cover and the panel tab are client state, ruled 2026-09-11', () => {
    // A stale `?doc=cover` or `?panel=collab` link is an unknown key - it opens the route, not a 404.
    expect(parseSubViews('script', { doc: 'cover', panel: 'collab' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('script', { doc: 'grid', panel: 'composer' })).toEqual({ ok: true, params: {} })
  })

  it('refuses a value that is not one of the views, naming the param', () => {
    expect(parseSubViews('scenes', { view: 'grid' })).toEqual({
      ok: false,
      param: 'view',
      value: 'grid',
    })
    expect(parseSubViews('timeline', { view: 'lens/nobody' })).toEqual({
      ok: false,
      param: 'view',
      value: 'lens/nobody',
    })
  })

  it('takes the first of a repeated key and ignores keys it does not know', () => {
    expect(parseSubViews('scenes', { view: ['index', 'list'], utm_source: 'x' })).toEqual({
      ok: true,
      params: { view: 'index' },
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
    expect(SIDEBAR.map((item) => navMeta(item.route, empty))).toEqual(['empty', '—', '0'])
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
