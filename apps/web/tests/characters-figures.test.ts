// @vitest-environment node
import type { SceneRef } from '@folio/contracts'
import { CHARACTER_COLORS, CHARACTER_COLOR_IDS, CharacterColorSchema, hueOfColor, projectId } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { characterId, locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { citeOf, formatSceneRef, sceneRefOf } from '../lib/characters/figures'

/**
 * The Characters route's figures - the scene ref and its citation, and the
 * colour tokens. The presence map and the scene facts left with the fourth
 * pass (2026-09-20).
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

describe('colours', () => {
  it('names every one of the ten tokens exactly once', () => {
    expect(CHARACTER_COLORS.map((color) => color.id)).toEqual([...CHARACTER_COLOR_IDS])
    expect(new Set(CHARACTER_COLORS.map((color) => color.hue)).size).toBe(10)
    expect(CHARACTER_COLORS.map((color) => color.hue)).toEqual(CHARACTER_COLORS.map((_, index) => index + 1))
  })

  it('reads a token as its --chip-N index, and an unknown one as the first', () => {
    expect(hueOfColor('chip-7')).toBe(7)
    expect(hueOfColor('not-a-token')).toBe(1)
    expect(CharacterColorSchema.safeParse('chip-11').success).toBe(false)
    expect(CharacterColorSchema.safeParse('chip-10').success).toBe(true)
  })
})

describe('scene refs', () => {
  const indexRow: SceneIndexRow = {
    sceneNodeId: node(1),
    number: 14,
    ordinalInEpisode: 3,
    heading: 'INT. WARD OFFICE - DAY',
    locationId: locationId('20000000-0000-4000-8000-000000000001') as LocationId,
    lines: 4,
    words: 31,
    cast: [person(1), person(2)],
    speaking: [person(1)],
    mentioned: [person(1), person(2)],
    episode: 'ep_002' as SceneIndexRow['episode'],
    episodeOrdinal: 2,
    ie: 'INT',
    light: 'day',
    timeOfDay: 'DAY',
  }

  it('prints a scene ref as E{episode} Sc {rank in episode}', () => {
    expect(formatSceneRef(sceneRefOf(indexRow))).toBe('E2 Sc 3')
    expect(sceneRefOf(indexRow)).toEqual({ sceneNodeId: node(1), episode: 'ep_002', episodeOrdinal: 2, number: 3, heading: 'INT. WARD OFFICE - DAY' })
  })
})

describe('citations', () => {
  const ref: SceneRef = { sceneNodeId: node(4), episode: 'ep_002' as SceneRef['episode'], episodeOrdinal: 2, number: 9, heading: 'INT. CHAWL - NIGHT' }

  it('points at the episode script with the heading fragment', () => {
    expect(citeOf(projectId('p1'), 'episodic', ref)).toEqual({
      label: 'E2 Sc 9',
      href: `/app/project/p1/ep_002/script#n-${node(4)}`,
    })
    expect(citeOf(projectId('p1'), 'collapsed', ref).href).toBe(`/app/project/p1/script#n-${node(4)}`)
  })
})
