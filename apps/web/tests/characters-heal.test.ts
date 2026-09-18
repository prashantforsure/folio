import type { CharacterRecord, DerivedEntities } from '@folio/script'
import { NO_ENTITIES, characterId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { healNameCues } from '../lib/characters/heal'

/**
 * The read-side backfill for records with no bound spelling - the ones the
 * `@` combobox made before it bound the name (`lib/characters/heal.ts`).
 */

const record = (id: string, name: string, boundCues: readonly string[]): CharacterRecord => ({
  id: characterId(`10000000-0000-4000-8000-${id.padStart(12, '0')}`),
  authored: { name, boundCues, bio: null, relationships: [], notes: {} },
  cues: [],
  words: 0,
  speeches: 0,
  parens: 0,
  namedIn: 0,
  firstLine: null,
  lastLine: null,
  longest: null,
  sceneCounts: [],
  exchanges: [],
  introducedAt: null,
  appearances: 0,
  scenes: [],
  lines: 0,
  mentions: 0,
  presence: 'absent',
})

const entitiesOf = (characters: readonly CharacterRecord[]): DerivedEntities => ({ ...NO_ENTITIES, characters })

describe('healNameCues', () => {
  it('binds the name spelling to a record with no bound cue', () => {
    const { entities, healed } = healNameCues(entitiesOf([record('1', 'Hale', [])]))
    expect(healed).toEqual([{ id: characterId('10000000-0000-4000-8000-000000000001'), cue: 'HALE' }])
    expect(entities.characters[0]?.authored.boundCues).toEqual(['HALE'])
  })

  it('leaves a record alone when another record already claims that key', () => {
    const byName = healNameCues(entitiesOf([record('1', 'Meera', []), record('2', 'Meera', ['MEERA'])]))
    expect(byName.healed).toEqual([])
    const byAlias = healNameCues(entitiesOf([record('1', 'Meera', []), record('2', 'Meera Pawar', ['MEERA'])]))
    expect(byAlias.healed).toEqual([])
    const twoBlank = healNameCues(entitiesOf([record('1', 'Meera', []), record('2', 'meera', [])]))
    expect(twoBlank.healed).toEqual([])
  })

  it('returns the same entities object when nothing heals', () => {
    const entities = entitiesOf([record('1', 'Meera', ['MEERA']), record('2', 'Anil', ['ANIL'])])
    const result = healNameCues(entities)
    expect(result.entities).toBe(entities)
    expect(result.healed).toEqual([])
  })

  it('heals several records at once and keeps the others untouched', () => {
    const { entities, healed } = healNameCues(
      entitiesOf([record('1', 'Hale', []), record('2', 'Meera', ['MEERA']), record('3', 'Kadam', [])]),
    )
    expect(healed.map((entry) => entry.cue)).toEqual(['HALE', 'KADAM'])
    expect(entities.characters[1]?.authored.boundCues).toEqual(['MEERA'])
  })
})
