import { describe, expect, it } from 'vitest'

import { sidesFor } from './sides'
import { idAt, nodesOf } from './testing/derive-corpus'

/** Sides: one part's speeches under the headings they fall in. */

const SCRIPT = [
  'scene:INT. KAMATHI CHAWL - CORRIDOR - NIGHT',
  'action:Rain.',
  'cue:MEERA',
  'paren:(quietly)',
  'dialogue:Two buckets. I counted.',
  'action:Kadam shrugs.',
  'dialogue:Orphan dialogue after action is not hers.',
  'cue:KADAM',
  'dialogue:Madam, the paper is the paper.',
  'scene:EXT. STANDPIPE - DAY',
  'cue:KADAM',
  'dialogue:Nothing of hers here.',
  'comment:MEERA should be angrier.',
  'scene:INT. OFFICE - DAY',
  'cue:Meera (V.O.)',
  'dialogue:And you said the fifteenth.',
] as const

describe('sidesFor', () => {
  it('keeps the heading, the cue, its parens and dialogue, and drops everything else', () => {
    const sides = sidesFor(nodesOf(SCRIPT), new Set(['MEERA']))
    expect(sides.map((node) => node.id)).toEqual([idAt(0), idAt(2), idAt(3), idAt(4), idAt(13), idAt(14), idAt(15)])
  })

  it('a heading with nothing of the part under it is dropped; a comment never appears', () => {
    const sides = sidesFor(nodesOf(SCRIPT), new Set(['MEERA']))
    expect(sides.some((node) => node.id === idAt(9))).toBe(false)
    expect(sides.some((node) => node.type === 'comment')).toBe(false)
  })

  it('reads several keys as one part and modifiers off the cue', () => {
    const sides = sidesFor(nodesOf(SCRIPT), new Set(['MEERA', 'KADAM']))
    expect(sides.filter((node) => node.type === 'character')).toHaveLength(4)
  })

  it('is empty for a part with no cue, and returns the nodes themselves', () => {
    expect(sidesFor(nodesOf(SCRIPT), new Set(['ANIL']))).toEqual([])
    const nodes = nodesOf(SCRIPT)
    expect(sidesFor(nodes, new Set(['MEERA']))[1]).toBe(nodes[2])
  })
})
