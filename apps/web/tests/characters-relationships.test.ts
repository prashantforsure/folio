// @vitest-environment node
import type { Relationship } from '@folio/contracts'
import { RelationshipInputSchema } from '@folio/contracts'
import { characterId } from '@folio/script'
import type { CharacterId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { describeRelationship, orderInput, orderPair, pairKey, pillLabels, relationshipOf } from '../lib/characters/relationships'

/**
 * A relationship read from either end - `lib/characters/relationships.ts`.
 */

const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const row: Relationship = {
  aId: person(1),
  bId: person(2),
  aIs: 'sister',
  bIs: 'brother',
  description: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
}

describe('the pair', () => {
  it('is sorted, and keyed sorted, whichever way round it comes', () => {
    expect(orderPair(person(2), person(1))).toEqual([person(1), person(2)])
    expect(pairKey(person(2), person(1))).toBe(pairKey(person(1), person(2)))
  })

  it('the input sorts its ids and swaps the labels with them', () => {
    const typed = { aId: person(2), bId: person(1), aIs: 'brother', bIs: 'sister', description: 'twins' }
    expect(orderInput(typed)).toEqual({ aId: person(1), bId: person(2), aIs: 'sister', bIs: 'brother', description: 'twins' })
    expect(orderInput({ ...typed, aId: person(1), bId: person(2) })).toEqual({ ...typed, aId: person(1), bId: person(2) })
  })
})

describe('reading a row', () => {
  it('reads from either side, null from neither', () => {
    expect(relationshipOf(row, person(1))).toEqual({ other: person(2), youAre: 'sister', theyAre: 'brother' })
    expect(relationshipOf(row, person(2))).toEqual({ other: person(1), youAre: 'brother', theyAre: 'sister' })
    expect(relationshipOf(row, person(3))).toBeNull()
  })

  it('describes both sides and skips a blank one; the pill prints a dash for a blank side', () => {
    const names = new Map([
      [person(1), 'Meera'],
      [person(2), 'Anil'],
    ])
    expect(describeRelationship(row, names)).toBe("Meera is Anil's sister · Anil is Meera's brother")
    expect(describeRelationship({ ...row, bIs: '' }, names)).toBe("Meera is Anil's sister")
    expect(pillLabels({ aIs: 'mother', bIs: '' })).toEqual(['mother', '—'])
  })
})

describe('the input schema', () => {
  it('refuses a self-pair and a pair with no label, trims and caps the labels', () => {
    expect(RelationshipInputSchema.safeParse({ aId: person(1), bId: person(1), aIs: 'x', bIs: '', description: null }).success).toBe(false)
    expect(RelationshipInputSchema.safeParse({ aId: person(1), bId: person(2), aIs: '  ', bIs: '', description: null }).success).toBe(false)
    const parsed = RelationshipInputSchema.safeParse({ aId: person(1), bId: person(2), aIs: ' sister ', bIs: '', description: ' twins ' })
    expect(parsed.success && parsed.data.aIs).toBe('sister')
    expect(parsed.success && parsed.data.description).toBe('twins')
    expect(RelationshipInputSchema.safeParse({ aId: person(1), bId: person(2), aIs: 'x'.repeat(41), bIs: '', description: null }).success).toBe(false)
  })
})
