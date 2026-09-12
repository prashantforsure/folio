// @vitest-environment node
import { episodeSlug } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { characterId, locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  FEW_USES,
  LINKED_CHARACTERS,
  LINKED_LOCATIONS,
  editedLabel,
  initialsOf,
  linkedFromCites,
} from '../lib/bible/figures'

/**
 * The Bible route's figures. Each is arithmetic over rows, and each test
 * says which line of the bundle it prints.
 *
 * Node environment: nothing here renders (`apps/web/CLAUDE.md`, trap 1).
 */

let counter = 0
const scene = (): NodeId => nodeId(`00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`)
const character = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const location = (n: number): LocationId => locationId(`20000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const row = (parts: Partial<SceneIndexRow> = {}): SceneIndexRow => ({
  sceneNodeId: scene(),
  number: 1,
  ordinalInEpisode: 1,
  heading: 'INT. SOMEWHERE - DAY',
  locationId: null,
  lines: 0,
  cast: [],
  speaking: [],
  episode: episodeSlug('ep_001'),
  episodeOrdinal: 1,
  ie: 'INT',
  light: 'day',
  timeOfDay: 'DAY',
  ...parts,
})

describe('initialsOf', () => {
  it('takes the first letter of the first two words, upper-cased', () => {
    expect(initialsOf('Prashant Patel')).toBe('PP')
    expect(initialsOf('meera')).toBe('M')
    expect(initialsOf('Anil Ravi Kumar')).toBe('AR')
    expect(initialsOf('  ')).toBe('·')
  })
})

describe('linkedFromCites', () => {
  const meera = character(1)
  const kadam = character(2)
  const anil = character(3)
  const chawl = location(1)
  const office = location(2)
  const names = new Map<CharacterId, string>([
    [meera, 'Meera'],
    [kadam, 'Kadam'],
    [anil, 'Anil'],
  ])
  const places = new Map<LocationId, string>([
    [chawl, 'Kamathi Chawl'],
    [office, 'Ward office'],
  ])

  it('reads the cast and location off the cited scenes, most scenes first', () => {
    const a = row({ cast: [meera, kadam], locationId: chawl })
    const b = row({ cast: [meera], locationId: chawl })
    const c = row({ cast: [anil], locationId: office })
    const uncited = row({ cast: [anil, kadam], locationId: office })
    const linked = linkedFromCites([a, b, c, uncited], new Set([a.sceneNodeId, b.sceneNodeId, c.sceneNodeId]), names, places)
    expect(linked.characters.map((person) => person.name)).toEqual(['Meera', 'Anil', 'Kadam'])
    expect(linked.locations.map((place) => place.name)).toEqual(['Kamathi Chawl', 'Ward office'])
  })

  it('is empty for an entry with no cite, and drops an id it cannot name', () => {
    const a = row({ cast: [character(9)], locationId: location(9) })
    expect(linkedFromCites([a], new Set(), names, places)).toEqual({ characters: [], locations: [] })
    expect(linkedFromCites([a], new Set([a.sceneNodeId]), names, places)).toEqual({ characters: [], locations: [] })
  })

  it('caps the chips at the aside’s counts', () => {
    const many = Array.from({ length: 10 }, (_, n) => character(n + 10))
    const wide = new Map(many.map((id, n) => [id, `Person ${String(n)}`]))
    const manyPlaces = Array.from({ length: 10 }, (_, n) => location(n + 10))
    const rows = manyPlaces.map((place, n) => row({ cast: many, locationId: place, ordinalInEpisode: n + 1 }))
    const widePlaces = new Map(manyPlaces.map((id, n) => [id, `Place ${String(n)}`]))
    const linked = linkedFromCites(rows, new Set(rows.map((entry) => entry.sceneNodeId)), wide, widePlaces)
    expect(linked.characters).toHaveLength(LINKED_CHARACTERS)
    expect(linked.locations).toHaveLength(LINKED_LOCATIONS)
  })
})

describe('editedLabel', () => {
  const now = Date.parse('2026-09-12T12:00:00Z')
  const at = (iso: string): string => iso

  it('prints the bundle’s scale: today, yesterday, days, weeks, then a date', () => {
    expect(editedLabel(at('2026-09-12T09:00:00Z'), now)).toBe('today')
    expect(editedLabel(at('2026-09-11T09:00:00Z'), now)).toBe('yesterday')
    expect(editedLabel(at('2026-09-09T12:00:00Z'), now)).toBe('3 days ago')
    expect(editedLabel(at('2026-09-05T12:00:00Z'), now)).toBe('1 week ago')
    expect(editedLabel(at('2026-08-22T12:00:00Z'), now)).toBe('3 weeks ago')
    expect(editedLabel(at('2026-06-01T12:00:00Z'), now)).toBe('1 Jun 2026')
    expect(editedLabel('not a date', now)).toBe('—')
  })
})

describe('the glossary threshold', () => {
  it('turns amber under four uses, the bundle’s own cut', () => {
    expect(FEW_USES).toBe(4)
  })
})
