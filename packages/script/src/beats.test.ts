import { describe, expect, it } from 'vitest'

import { outlineBeats, outlineHeadings, outlineWordCount, readBeatHeadline } from './beats'
import { characterId, nodeId } from './ids'
import { mention, text } from './inline'
import { NO_LABELS, labelBook } from './measure'
import type { OutlineNode } from './outline'
import { typed } from './provenance'

/**
 * Beats read off the outline. The number is the ordinal, the name is the
 * text before the first colon, and neither is stored anywhere.
 */

let counter = 0
const block = (type: Exclude<OutlineNode['type'], 'rule'>, value: string): OutlineNode => ({
  type,
  id: nodeId(`n${String((counter += 1))}`),
  provenance: typed(),
  content: [text(value)],
})
const rule = (): OutlineNode => ({ type: 'rule', id: nodeId(`n${String((counter += 1))}`), provenance: typed() })

describe('readBeatHeadline', () => {
  it('splits on the first colon and trims both halves', () => {
    expect(readBeatHeadline('Opening Image: empty pitch, Ade training alone.')).toEqual({
      name: 'Opening Image',
      line: 'empty pitch, Ade training alone.',
    })
  })

  it('keeps later colons in the line', () => {
    expect(readBeatHeadline('Catalyst: the old man says: don’t think.')).toEqual({
      name: 'Catalyst',
      line: 'the old man says: don’t think.',
    })
  })

  it('reads a block with no colon as a name with no line', () => {
    expect(readBeatHeadline('  Decision Point  ')).toEqual({ name: 'Decision Point', line: '' })
  })

  it('reads an empty block as nothing', () => {
    expect(readBeatHeadline('')).toEqual({ name: '', line: '' })
  })
})

describe('outlineBeats', () => {
  it('numbers the beat blocks in document order and skips every other block', () => {
    const nodes = [
      block('h1', 'Story Beats'),
      block('beat', 'Opening Image: the pitch'),
      block('body', 'Some prose between.'),
      rule(),
      block('beat', 'Catalyst: the old man'),
      block('h2', 'Act Two'),
      block('beat', 'The Kick'),
    ]
    const beats = outlineBeats(nodes)
    expect(beats.map((beat) => [beat.ordinal, beat.id])).toEqual([
      [1, nodes[1]?.id],
      [2, nodes[4]?.id],
      [3, nodes[6]?.id],
    ])
    expect(beats.every((beat) => beat.node.type === 'beat')).toBe(true)
  })

  it('is empty for an outline with no beat', () => {
    expect(outlineBeats([block('h1', 'Logline'), block('body', 'A boy.')])).toEqual([])
  })
})

describe('outlineHeadings', () => {
  it('lists the three heading levels with their text, mentions by label', () => {
    const meera = characterId('c1')
    const nodes: OutlineNode[] = [
      block('h1', 'Logline'),
      block('body', 'prose'),
      { type: 'h2', id: nodeId('h2'), provenance: typed(), content: [text('About '), mention({ entity: 'character', id: meera })] },
      block('h3', 'Detail'),
    ]
    const labels = labelBook([{ entity: 'character', id: meera, label: 'Meera' }])
    expect(outlineHeadings(nodes, labels)).toEqual([
      { id: nodes[0]?.id, level: 1, text: 'Logline' },
      { id: nodeId('h2'), level: 2, text: 'About Meera' },
      { id: nodes[3]?.id, level: 3, text: 'Detail' },
    ])
  })
})

describe('outlineWordCount', () => {
  it('counts words across text blocks, a rule as zero, a mention as one word', () => {
    const nodes: OutlineNode[] = [
      block('h1', 'Story Beats'),
      block('body', 'On the edge of giving up.'),
      rule(),
      block('quote', ''),
      { type: 'beat', id: nodeId('b'), provenance: typed(), content: [text('The kick: '), mention({ entity: 'character', id: characterId('c1') })] },
    ]
    expect(outlineWordCount(nodes, NO_LABELS)).toBe(2 + 6 + 0 + 0 + 3)
  })
})
