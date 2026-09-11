import { RESERVED_PROJECT_SEGMENTS, parseEpisodeSegment } from '@folio/contracts'
import { assertCreatableEpisodeSlug, mintEpisodeSlug } from '@folio/db'
import { describe, expect, it } from 'vitest'

import { EPISODE_ROUTES, PROJECT_ROUTES } from '../lib/workspace/routes'
import { episodeSegmentFromSegments, railSectionFromSegments } from '../lib/workspace/segments'

/**
 * The episode segment, refused explicitly - at validation and at creation.
 *
 * AGENTS.md, Routing: "`:episodeId` shares a path position with the
 * project-scoped names. Validate every episode id against `characters`,
 * `locations`, `timeline`, `bible`, `research`, `insights`, `production`,
 * `settings`, `assets`, and keep ids to the `ep_NNN` shape. Static-first
 * precedence saves this tree by accident; do not rely on it."
 *
 * Two functions, one check. `parseEpisodeSegment` is what the router runs
 * on a URL; `assertCreatableEpisodeSlug` is what every episode insert runs
 * before it writes. The same list, the same shape, and this file shows both
 * refusing `characters`.
 */

describe('parseEpisodeSegment - the router', () => {
  it('accepts ep_NNN', () => {
    expect(parseEpisodeSegment('ep_001')).toEqual({ ok: true, slug: 'ep_001' })
    expect(parseEpisodeSegment('ep_1234')).toEqual({ ok: true, slug: 'ep_1234' })
  })

  it('refuses `characters` by name, not merely by shape', () => {
    expect(parseEpisodeSegment('characters')).toEqual({
      ok: false,
      reason: 'reserved',
      segment: 'characters',
    })
  })

  it('refuses every reserved project name by name', () => {
    for (const name of RESERVED_PROJECT_SEGMENTS) {
      expect(parseEpisodeSegment(name)).toEqual({ ok: false, reason: 'reserved', segment: name })
    }
  })

  it('names the nine AGENTS.md lists, in its order, with assets kept', () => {
    expect(RESERVED_PROJECT_SEGMENTS).toEqual([
      'characters',
      'locations',
      'timeline',
      'bible',
      'research',
      'insights',
      'production',
      'settings',
      'assets',
    ])
  })

  it('refuses anything outside the ep_NNN shape', () => {
    for (const bad of ['ep_1', 'EP_001', 'ep-001', 'episode-1', '', 'script', 'ep_001/x', 'ep_00a']) {
      expect(parseEpisodeSegment(bad)).toEqual({ ok: false, reason: 'shape', segment: bad })
    }
  })

  it('cannot accept a route name: every episode route fails the shape', () => {
    for (const route of EPISODE_ROUTES) expect(parseEpisodeSegment(route).ok).toBe(false)
    for (const route of PROJECT_ROUTES) expect(parseEpisodeSegment(route).ok).toBe(false)
  })
})

describe('assertCreatableEpisodeSlug - the repository', () => {
  it('refuses to create an episode called `characters`', () => {
    expect(() => assertCreatableEpisodeSlug('characters')).toThrowError(
      /refused to create an episode with slug "characters": "characters" is a project-scoped route name/,
    )
  })

  it('refuses every reserved name and every malformed slug', () => {
    for (const name of RESERVED_PROJECT_SEGMENTS) {
      expect(() => assertCreatableEpisodeSlug(name)).toThrow()
    }
    expect(() => assertCreatableEpisodeSlug('ep_1')).toThrowError(/not of the ep_NNN shape/)
  })

  it('mints ep_NNN from an ordinal, and that is the only shape it mints', () => {
    expect(mintEpisodeSlug(1)).toBe('ep_001')
    expect(mintEpisodeSlug(12)).toBe('ep_012')
    expect(mintEpisodeSlug(1234)).toBe('ep_1234')
  })
})

describe('railSectionFromSegments', () => {
  const WRITING = ['script', 'outline', 'beats', 'storyboard', 'scenes', 'revisions', 'notes'] as const

  it('lights Writing on all seven episode routes - Notes and Revisions included', () => {
    for (const route of WRITING) {
      expect(railSectionFromSegments(['ep_001', '(writing)', route])).toBe('writing')
      expect(railSectionFromSegments(['(film)', '(writing)', route])).toBe('writing')
    }
  })

  it('lights Production on the episode-scoped production route, in both shapes', () => {
    expect(railSectionFromSegments(['ep_001', 'production'])).toBe('production')
    expect(railSectionFromSegments(['(film)', 'production'])).toBe('production')
  })

  it('lights each project route as itself', () => {
    for (const route of PROJECT_ROUTES) expect(railSectionFromSegments([route])).toBe(route)
  })

  it('lights Writing on the two index redirects', () => {
    expect(railSectionFromSegments([])).toBe('writing')
    expect(railSectionFromSegments(['ep_001'])).toBe('writing')
  })

  it('lights nothing on settings', () => {
    expect(railSectionFromSegments(['settings'])).toBeNull()
  })
})

describe('episodeSegmentFromSegments', () => {
  it('finds the episode in an episodic URL and nothing in a collapsed or project one', () => {
    expect(episodeSegmentFromSegments(['ep_003', '(writing)', 'notes'])).toBe('ep_003')
    expect(episodeSegmentFromSegments(['(film)', '(writing)', 'notes'])).toBeNull()
    expect(episodeSegmentFromSegments(['characters'])).toBeNull()
    expect(episodeSegmentFromSegments([])).toBeNull()
  })
})
