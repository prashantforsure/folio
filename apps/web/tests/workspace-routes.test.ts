import { GLYPHS } from '@folio/ui'
import { projectId, episodeSlug } from '@folio/contracts'
import { describe, expect, it } from 'vitest'

import type { EpisodeNavMeta } from '@folio/contracts'

import {
  eighths,
  episodeGroupLabel,
  episodeNumber,
  navMeta,
  projectInitials,
} from '../lib/workspace/format'
import { episodeRouteHref, projectHref, projectRouteHref } from '../lib/workspace/hrefs'
import { parseSubViews, SUB_VIEW_SCHEMAS } from '../lib/workspace/params'
import {
  CONTEXT_PANEL_WIDTH,
  EPISODE_NAV,
  EPISODE_NAV_WIDTH,
  RAIL,
  WORKSPACE_ROUTES,
  WORKSPACE_ROUTE_COUNT,
  railSectionOf,
} from '../lib/workspace/routes'

/**
 * The route tree, the two orders, the params and the formatting convention.
 * All data and pure functions; the E2E walk checks the same facts in a
 * browser.
 */

describe('the route tree', () => {
  it('is fourteen routes under the rulings on decisions 5, 6 and assets', () => {
    expect(WORKSPACE_ROUTES).toHaveLength(WORKSPACE_ROUTE_COUNT)
    expect(WORKSPACE_ROUTES).toEqual([
      'script',
      'outline',
      'beats',
      'storyboard',
      'scenes',
      'revisions',
      'notes',
      'production',
      'characters',
      'locations',
      'timeline',
      'bible',
      'research',
      'insights',
    ])
    // Decision 6: cut. Not routes.
    expect(WORKSPACE_ROUTES).not.toContain('build')
    expect(WORKSPACE_ROUTES).not.toContain('search')
    // assets: reserved, no route.
    expect(WORKSPACE_ROUTES).not.toContain('assets')
    // Settings is a stub, not one of the fourteen.
    expect(WORKSPACE_ROUTES).not.toContain('settings')
  })
})

describe('the rail', () => {
  it('is eight items, exactly this order, each with its specified glyph', () => {
    expect(RAIL.map((item) => `${item.label} ${GLYPHS[item.glyph]}`)).toEqual([
      'Writing ✎',
      'Characters ◍',
      'Locations ⌖',
      'Timeline ◷',
      'Bible ◈',
      'Research ▧',
      'Insights ◎',
      'Production ▶',
    ])
  })

  it('lights Writing for all seven episode nav routes and itself for the rest', () => {
    for (const item of EPISODE_NAV) expect(railSectionOf(item.route)).toBe('writing')
    expect(railSectionOf('production')).toBe('production')
    expect(railSectionOf('bible')).toBe('bible')
  })
})

describe('the episode nav', () => {
  it('is seven rows with Storyboard above Scenes, and 238px', () => {
    expect(EPISODE_NAV.map((item) => `${item.label} ${GLYPHS[item.glyph]}`)).toEqual([
      'Script ▤',
      'Outline ⋮',
      'Beats ⧗',
      'Storyboard ▥',
      'Scenes ▢',
      'Revisions ⇄',
      'Notes ❝',
    ])
    expect(EPISODE_NAV_WIDTH).toBe(238)
  })

  it('keeps the README widths for the other columns', () => {
    expect(CONTEXT_PANEL_WIDTH).toEqual({
      production: 250,
      characters: 256,
      locations: 256,
      timeline: 250,
      bible: 252,
      research: 250,
      insights: 250,
    })
  })
})

describe('sub-view params', () => {
  it('has a schema for every one of the fourteen', () => {
    expect(Object.keys(SUB_VIEW_SCHEMAS).sort()).toEqual([...WORKSPACE_ROUTES].sort())
  })

  it('defaults each param to its first value', () => {
    expect(parseSubViews('beats', {})).toEqual({ ok: true, params: { view: 'beats' } })
    expect(parseSubViews('storyboard', {})).toEqual({ ok: true, params: { view: 'board' } })
    expect(parseSubViews('scenes', {})).toEqual({ ok: true, params: { view: 'cards' } })
    expect(parseSubViews('revisions', {})).toEqual({ ok: true, params: { view: 'diff' } })
    expect(parseSubViews('notes', {})).toEqual({ ok: true, params: { filter: 'open' } })
    expect(parseSubViews('production', {})).toEqual({ ok: true, params: { view: 'scene' } })
    expect(parseSubViews('characters', {})).toEqual({ ok: true, params: { view: 'profile' } })
    expect(parseSubViews('locations', {})).toEqual({ ok: true, params: { view: 'record' } })
    expect(parseSubViews('timeline', {})).toEqual({ ok: true, params: { view: 'story' } })
    expect(parseSubViews('bible', {})).toEqual({ ok: true, params: { view: 'entry' } })
    expect(parseSubViews('research', {})).toEqual({ ok: true, params: { view: 'library' } })
    expect(parseSubViews('outline', {})).toEqual({ ok: true, params: {} })
    expect(parseSubViews('script', {})).toEqual({ ok: true, params: {} })
  })

  it('gives script no params: the cover and the panel tab are client state, ruled 2026-09-11', () => {
    // A stale `?doc=cover` or `?panel=collab` link is an unknown key - it opens the route, not a 404.
    expect(parseSubViews('script', { doc: 'cover', panel: 'collab' })).toEqual({ ok: true, params: {} })
    expect(parseSubViews('script', { doc: 'grid', panel: 'composer' })).toEqual({ ok: true, params: {} })
  })

  it('gives insights two params, report and lens, never one', () => {
    expect(parseSubViews('insights', {})).toEqual({
      ok: true,
      params: { report: 'pacing', lens: 'showrunner' },
    })
    expect(parseSubViews('insights', { report: 'presence', lens: 'producer' })).toEqual({
      ok: true,
      params: { report: 'presence', lens: 'producer' },
    })
  })

  it('accepts both candidate lens spellings until decision 4 is ruled', () => {
    expect(parseSubViews('insights', { lens: 'lens/viewer' })).toEqual({
      ok: true,
      params: { report: 'pacing', lens: 'viewer' },
    })
    expect(parseSubViews('insights', { lens: 'viewer' })).toEqual({
      ok: true,
      params: { report: 'pacing', lens: 'viewer' },
    })
  })

  it('refuses a value that is not one of the views, naming the param', () => {
    expect(parseSubViews('scenes', { view: 'grid' })).toEqual({
      ok: false,
      param: 'view',
      value: 'grid',
    })
    expect(parseSubViews('insights', { lens: 'lens/nobody' })).toEqual({
      ok: false,
      param: 'lens',
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
    expect(episodeRouteHref({ projectId: id, shape: 'episodic', episode: ep }, 'notes')).toBe(
      `/app/project/${id}/ep_002/notes`,
    )
    expect(episodeRouteHref({ projectId: id, shape: 'collapsed', episode: ep }, 'notes')).toBe(
      `/app/project/${id}/notes`,
    )
    expect(episodeRouteHref({ projectId: id, shape: 'collapsed', episode: ep }, 'production')).toBe(
      `/app/project/${id}/production`,
    )
    expect(projectRouteHref(id, 'bible')).toBe(`/app/project/${id}/bible`)
    expect(projectHref(id)).toBe(`/app/project/${id}`)
  })
})

describe('the meta convention', () => {
  const empty: EpisodeNavMeta = {
    script: 'absent',
    acts: null,
    beats: null,
    shots: null,
    scenes: 0,
    draft: null,
    openNotes: 0,
  }

  it('prints a new project as the brief specifies', () => {
    expect(EPISODE_NAV.map((item) => navMeta(item.route, empty))).toEqual([
      'empty',
      '—',
      '—',
      '—',
      '0',
      '—',
      '0',
    ])
  })

  it('prints a populated episode as the bundle does', () => {
    const populated: EpisodeNavMeta = {
      script: { pages: 104 },
      acts: 3,
      beats: 6,
      shots: 38,
      scenes: 34,
      draft: 5,
      openNotes: 4,
    }
    expect(EPISODE_NAV.map((item) => navMeta(item.route, populated))).toEqual([
      '104pp',
      '3 acts',
      '6',
      '38 shots',
      '34',
      'Draft 5',
      '4 open',
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
    expect(episodeGroupLabel(1, 'Standpipe')).toBe('Ep 1 · Standpipe')
  })
})
