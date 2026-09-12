// @vitest-environment node
import type { OutlineNode } from '@folio/script'
import { characterId, mention, nodeId, text, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { filterSlashMenu, typeForDigit, typeForShiftLetter } from '../lib/outline/keyboard'
import { ELEMENT_TYPE_COVERAGE, fromSlateValue, toSlateValue } from '../lib/outline/slate-model'

/**
 * The outline's Slate boundary. The same guarantees `lib/script/slate-model.ts`
 * makes for the eight, over the seven: a round trip is an identity, a rule
 * carries no content field, and a shape Plate could produce - a paragraph, a
 * mark, a screenplay type - cannot be saved.
 */

const outline: readonly OutlineNode[] = [
  { type: 'h1', id: nodeId('a'), provenance: typed(), content: [text('Logline')] },
  {
    type: 'body',
    id: nodeId('b'),
    provenance: typed(),
    content: [text('About '), mention({ entity: 'character', id: characterId('c1') }), text(', mostly.')],
  },
  { type: 'quote', id: nodeId('c'), provenance: typed(), content: [text('Not gifted. Just stubborn.')] },
  { type: 'rule', id: nodeId('d'), provenance: typed() },
  { type: 'beat', id: nodeId('e'), provenance: typed(), content: [text('Opening Image: the pitch')] },
  { type: 'h2', id: nodeId('f'), provenance: typed(), content: [text('Act two')] },
  { type: 'h3', id: nodeId('g'), provenance: typed(), content: [text('Detail')] },
]

describe('the outline round trip', () => {
  it('is an identity over every block type, mention included', () => {
    const value = toSlateValue(outline)
    const back = fromSlateValue(value)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value).toEqual(outline)
  })

  it('gives a rule one empty text child on the way in and no content on the way out', () => {
    const rule = toSlateValue(outline)[3]
    expect(rule).toEqual({ type: 'rule', id: 'd', provenance: { source: 'typed' }, children: [{ text: '' }] })
    const back = fromSlateValue([{ ...rule, children: [{ text: 'ignored' }] }])
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value[0]).toEqual({ type: 'rule', id: 'd', provenance: { source: 'typed' } })
  })

  it('covers the seven and no other', () => {
    expect(Object.keys(ELEMENT_TYPE_COVERAGE).sort()).toEqual(['beat', 'body', 'h1', 'h2', 'h3', 'quote', 'rule'])
  })
})

describe('what cannot be saved', () => {
  it('refuses a screenplay type at the top level', () => {
    const back = fromSlateValue([{ type: 'action', id: 'x', provenance: typed(), children: [{ text: 'no' }] }])
    expect(back.ok).toBe(false)
    if (!back.ok) expect(back.error).toEqual({ kind: 'not-a-block-type', index: 0, type: 'action' })
  })

  it("refuses a Plate paragraph and a mark - neither is the union's", () => {
    const paragraph = fromSlateValue([{ type: 'p', id: 'x', provenance: typed(), children: [{ text: 'no' }] }])
    expect(paragraph.ok).toBe(false)
    const marked = fromSlateValue([{ type: 'body', id: 'x', provenance: typed(), children: [{ text: 'bold', bold: true }] }])
    expect(marked.ok).toBe(false)
    if (!marked.ok) expect(marked.error).toEqual({ kind: 'bad-inline', index: 0, child: 0 })
  })

  it('refuses a duplicate id', () => {
    const first = outline[0]
    if (first === undefined) throw new Error('the fixture has a first block')
    const value = toSlateValue([first, { type: 'body', id: first.id, provenance: first.provenance, content: [text('again')] }])
    const back = fromSlateValue(value)
    expect(back.ok).toBe(false)
    if (!back.ok && back.error.kind === 'model') expect(back.error.defect.reason.kind).toBe('duplicate-node-id')
  })
})

describe('the keyboard model', () => {
  it('maps ⌘0-3 and ⌘⇧Q/R/B to the closed set', () => {
    expect(['0', '1', '2', '3'].map(typeForDigit)).toEqual(['body', 'h1', 'h2', 'h3'])
    expect(typeForDigit('4')).toBeNull()
    expect(['q', 'R', 'b', 'x'].map(typeForShiftLetter)).toEqual(['quote', 'rule', 'beat', null])
  })

  it('narrows the slash menu by label and keyword, and offers everything for an empty query', () => {
    expect(filterSlashMenu('').map((entry) => entry.type)).toEqual(['h1', 'h2', 'h3', 'quote', 'rule', 'beat', 'body'])
    expect(filterSlashMenu('be').map((entry) => entry.type)).toEqual(['beat'])
    expect(filterSlashMenu('h').map((entry) => entry.type)).toEqual(['h1', 'h2', 'h3', 'rule'])
    expect(filterSlashMenu('zz')).toEqual([])
  })
})
