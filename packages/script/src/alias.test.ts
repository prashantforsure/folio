import { describe, expect, it } from 'vitest'

import { canonicalKey, compare, scoreMatch } from './alias'

/**
 * The alias table's scoring, with its reasons.
 *
 * `compare` is the proposal's weight and has always been asserted through
 * derivation (`derive.test.ts`, "the resolve queue"). `scoreMatch` is the
 * same function carrying the branch it took, so the queue can print *why* it
 * is asking. The contract between the two is the last case: one is the other
 * without the reason, for every pair.
 */
describe('scoreMatch', () => {
  it('equal keys are certain with the exact reason', () => {
    expect(scoreMatch('MEERA', 'MEERA')).toEqual({ confidence: 'certain', reason: { kind: 'exact' } })
  })

  it('a leading token run is likely and names the shorter key, whichever side it is', () => {
    expect(scoreMatch('SURESH', 'SURESH KADAM')).toEqual({
      confidence: 'likely',
      reason: { kind: 'leading', shorter: 'SURESH' },
    })
    expect(scoreMatch('SURESH KADAM', 'SURESH')).toEqual({
      confidence: 'likely',
      reason: { kind: 'leading', shorter: 'SURESH' },
    })
  })

  it('a contained key is possible and names the inner key', () => {
    expect(scoreMatch('YOUNG MEERA', 'MEERA')).toEqual({
      confidence: 'possible',
      reason: { kind: 'contains', inner: 'MEERA' },
    })
    expect(scoreMatch('MEERA', 'YOUNG MEERA')).toEqual({
      confidence: 'possible',
      reason: { kind: 'contains', inner: 'MEERA' },
    })
  })

  it('a near miss on a long key is possible with the distance', () => {
    expect(scoreMatch('MEERAA', 'MEERA')).toEqual({
      confidence: 'possible',
      reason: { kind: 'edits', distance: 1 },
    })
  })

  it('short keys, empty keys and unrelated keys score nothing', () => {
    expect(scoreMatch('ANI', 'ANU')).toBeNull()
    expect(scoreMatch('', 'MEERA')).toBeNull()
    expect(scoreMatch('MEERA', 'ANIL')).toBeNull()
  })

  it('compare is scoreMatch without the reason', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['MEERA', 'MEERA'],
      ['SURESH', 'SURESH KADAM'],
      ['YOUNG MEERA', 'MEERA'],
      ['MEERAA', 'MEERA'],
      ['ANI', 'ANU'],
      ['MEERA', 'ANIL'],
      [canonicalKey("Meera's"), canonicalKey('MEERAS')],
    ]
    for (const [subject, candidate] of pairs) {
      expect(compare(subject, candidate)).toBe(scoreMatch(subject, candidate)?.confidence ?? null)
    }
  })
})
