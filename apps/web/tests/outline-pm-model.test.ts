// @vitest-environment node
import type { OutlineNode } from '@folio/script'
import { characterId, mention, nodeId, text, typed } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { typeForDigit, typeForShiftLetter } from '../lib/outline/keyboard'
import { BLOCK_TYPE_COVERAGE, fromDoc, shapeOf, toDoc } from '../lib/outline/pm-model'
import { filterSlash, slashMenuFor, slashOpensAt, slashQueryClosed } from '../lib/outline/slash'
import { outlineSchema } from './helpers/outline-state'

/**
 * The outline's ProseMirror boundary. The same guarantees `lib/script/
 * pm-model.ts` makes for the eight, over the seven: a round trip is an
 * identity, a rule carries no content field, and a shape the editor could
 * be handed - a paragraph, a mark, a screenplay type - cannot be built or
 * cannot be saved.
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
    const doc = outlineSchema().nodeFromJSON(toDoc(outline))
    const back = fromDoc(doc)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value).toEqual(outline)
  })

  it('makes a rule a leaf with no content on either side', () => {
    const json = toDoc(outline)
    expect(json.content?.[3]).toEqual({ type: 'rule', attrs: { id: 'd', provenance: { source: 'typed' }, origin: null } })
    const doc = outlineSchema().nodeFromJSON(json)
    expect(doc.child(3).isLeaf).toBe(true)
    const back = fromDoc(doc)
    if (back.ok) expect(back.value[3]).toEqual({ type: 'rule', id: 'd', provenance: { source: 'typed' } })
  })

  it('covers the seven and no other', () => {
    expect(Object.keys(BLOCK_TYPE_COVERAGE).sort()).toEqual(['beat', 'body', 'h1', 'h2', 'h3', 'quote', 'rule'])
  })

  it('counts blocks, acts, beats and words, mentions by their label', () => {
    const doc = outlineSchema().nodeFromJSON(toDoc(outline))
    expect(shapeOf(doc, () => 'Meera Rao')).toEqual({ blockCount: 7, acts: 1, beats: 1, words: 16 })
  })
})

describe('what cannot be built or saved', () => {
  it('has no screenplay block and no paragraph in the schema', () => {
    const { nodes } = outlineSchema()
    expect(nodes['action']).toBeUndefined()
    expect(nodes['scene']).toBeUndefined()
    expect(nodes['paragraph']).toBeUndefined()
    expect(Object.keys(nodes).sort()).toEqual(['beat', 'body', 'doc', 'h1', 'h2', 'h3', 'mention', 'quote', 'rule', 'text'])
  })

  it('has no marks', () => {
    expect(Object.keys(outlineSchema().marks)).toEqual([])
  })

  it('refuses a block without an id - one the identity plugin has not minted yet', () => {
    const schema = outlineSchema()
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'body', attrs: { id: null, provenance: typed(), origin: null }, content: [] }] })
    const back = fromDoc(doc)
    expect(back.ok).toBe(false)
    if (!back.ok) expect(back.error.kind).toBe('model')
  })

  it('refuses a duplicate id', () => {
    const first = outline[0]
    if (first === undefined) throw new Error('the fixture has a first block')
    const doc = outlineSchema().nodeFromJSON(toDoc([first, { type: 'body', id: first.id, provenance: first.provenance, content: [text('again')] }]))
    const back = fromDoc(doc)
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
})

describe('the slash menu', () => {
  it('offers the seven under Structure and Prose for a bare slash, and one ranked list once typed', () => {
    const bare = slashMenuFor('')
    expect(bare.sections.map((section) => section.title)).toEqual(['Structure', 'Prose'])
    expect(bare.rows.map((entry) => entry.type)).toEqual(['h1', 'h2', 'h3', 'beat', 'body', 'quote', 'rule'])
    expect(slashMenuFor('be').sections.map((section) => section.title)).toEqual(['Blocks'])
    expect(slashMenuFor('zz').sections).toEqual([])
  })

  it('names the rows for the story but every row is one of the seven', () => {
    expect(filterSlash('act').map((entry) => [entry.type, entry.label])).toEqual([['h1', 'Act heading']])
    expect(filterSlash('seq')[0]?.type).toBe('h2')
    expect(filterSlash('be').map((entry) => entry.type)).toEqual(['beat'])
    expect(filterSlash('note')[0]?.type).toBe('quote')
    expect(filterSlash('research')[0]?.type).toBe('quote')
    // Prefix matches lead; the blocks whose label or keyword merely contains an 'h' trail them.
    expect(filterSlash('h').map((entry) => entry.type)).toEqual(['h1', 'h2', 'h3', 'rule', 'body', 'quote'])
    expect(filterSlash('zz')).toEqual([])
  })

  it('opens at a block start or after a space, and closes once the query is a sentence', () => {
    expect(slashOpensAt('')).toBe(true)
    expect(slashOpensAt('and ')).toBe(true)
    expect(slashOpensAt('and')).toBe(false)
    expect(slashQueryClosed('scene b')).toBe(false)
    expect(slashQueryClosed('and then ')).toBe(true)
    expect(slashQueryClosed('a  b')).toBe(true)
  })
})
